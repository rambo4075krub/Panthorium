"""Fail closed on accidental public access or a privileged/shared speaker identity."""
import json
import re
import sys


def require(condition, message):
    if not condition:
        raise ValueError(message)


def verify_identity(project, speaker, backend, account, project_policy):
    require(speaker == f"speaker-runtime@{project}.iam.gserviceaccount.com", "Configure the dedicated speaker runtime account")
    require(backend.endswith(f"@{project}.iam.gserviceaccount.com") and backend != speaker, "Backend and speaker must have separate identities")
    require(account.get("email") == speaker and account.get("disabled") is not True, "Speaker runtime account missing or disabled")
    for binding in project_policy.get("bindings", []):
        members = binding.get("members", [])
        require(not {"allUsers", "allAuthenticatedUsers"}.intersection(members), "Public project IAM bindings require review")
        require(f"serviceAccount:{speaker}" not in members, "Speaker runtime needs no project-level IAM roles")


def verify_service(speaker, backend, service, policy):
    require(service.get("spec", {}).get("template", {}).get("spec", {}).get("serviceAccountName") == speaker, "Unexpected deployed speaker identity")
    annotations = service.get("metadata", {}).get("annotations", {})
    require(str(annotations.get("run.googleapis.com/invoker-iam-disabled", "false")).lower() == "false", "Invoker IAM check must be enabled")
    expected = f"serviceAccount:{backend}"
    callers = set()
    for binding in policy.get("bindings", []):
        members = set(binding.get("members", []))
        require(not {"allUsers", "allAuthenticatedUsers"}.intersection(members), "Speaker service must not have public IAM bindings")
        if binding.get("role") == "roles/run.invoker":
            callers.update(members)
    require(callers == {expected}, "Only the configured backend may invoke this speaker service")


def verify_candidate(service_name, candidate, current, expected_image=None):
    revision = candidate.get("status", {}).get("latestReadyRevisionName", "")
    require(re.fullmatch(re.escape(service_name) + r"-[a-z0-9-]+", revision) is not None, "Missing ready candidate revision")
    require(candidate.get("status", {}).get("latestCreatedRevisionName") == revision, "Candidate is not ready")
    require(current.get("status", {}).get("latestReadyRevisionName") == revision, "Another revision replaced the inspected candidate")
    require(current.get("status", {}).get("latestCreatedRevisionName") == revision, "A newer unverified revision exists")
    if expected_image is not None:
        require(re.fullmatch(r"[a-z0-9][a-z0-9./_-]*@sha256:[0-9a-f]{64}", expected_image) is not None,
                "Expected image must use an immutable SHA-256 digest")
        for service in (candidate, current):
            containers = service.get("spec", {}).get("template", {}).get("spec", {}).get("containers", [])
            require(len(containers) == 1 and containers[0].get("image") == expected_image,
                    "Ready candidate must run exactly the verified image")
    return revision


if __name__ == "__main__":
    mode, speaker, backend, *paths = sys.argv[1:]
    documents = [json.load(open(path, encoding="utf8")) for path in paths]
    if mode == "identity":
        project = speaker.split("@", 1)[1].removesuffix(".iam.gserviceaccount.com")
        verify_identity(project, speaker, backend, *documents)
    elif mode == "service":
        verify_service(speaker, backend, *documents)
    elif mode in {"candidate", "candidate-image"}:
        require(mode == "candidate-image" or backend == "-", "Unexpected candidate argument")
        print(verify_candidate(speaker, *documents, expected_image=backend if mode == "candidate-image" else None))
        sys.exit(0)
    else:
        raise ValueError("Unknown speaker verification mode")
    print(f"Speaker {mode} security checks passed")
