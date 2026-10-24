#!/usr/bin/env python3
"""Read selected Cloud Run/IAM state without changing cloud resources or printing secrets."""
import argparse
from datetime import datetime, timezone
import json
import os
import re
import shutil
import subprocess
import sys
from types import MappingProxyType


REQUIRED_BACKEND_ENV = ("BIOMETRIC_SPEAKER_URL", "BIOMETRIC_TEMPLATE_KEY")
INVOKER_ANNOTATION = "run.googleapis.com/invoker-iam-disabled"
# Project individual fields, never the whole annotations map or environment entries:
# kubectl last-applied annotations and env.value can contain credentials.
SERVICE_FORMAT = (
    "json(metadata.name,metadata.annotations.[run.googleapis.com/invoker-iam-disabled],"
    "spec.template.spec.serviceAccountName,spec.template.spec.containers[].env[].name,"
    "status.latestReadyRevisionName,status.latestCreatedRevisionName,"
    "status.traffic[].revisionName,status.traffic[].percent)"
)


class ReadFailure(Exception):
    """A fixed diagnostic code; raw gcloud output must not be exposed."""


def validate_identifier(value, kind):
    pattern = r"[a-z][a-z0-9-]{4,28}[a-z0-9]" if kind == "project" else r"[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?"
    if not isinstance(value, str) or re.fullmatch(pattern, value) is None:
        raise ValueError("Invalid " + kind + " identifier")
    return value


class CloudReader:
    """Only the exact, projected read commands constructed here may execute."""

    def __init__(self, project, region, backend, speaker, runner=subprocess.run):
        self.project = validate_identifier(project, "project")
        self.region = validate_identifier(region, "region")
        self.backend = validate_identifier(backend, "service")
        self.speaker = validate_identifier(speaker, "service")
        if backend == speaker:
            raise ValueError("Backend and speaker services must differ")
        self.speaker_account = f"speaker-runtime@{project}.iam.gserviceaccount.com"
        common = ("--project=" + project, "--quiet", "--verbosity=error")
        regional = common + ("--region=" + region,)
        self.commands = MappingProxyType({
            "backend_service": ("gcloud", "run", "services", "describe", backend, *regional, "--format=" + SERVICE_FORMAT),
            "speaker_service": ("gcloud", "run", "services", "describe", speaker, *regional, "--format=" + SERVICE_FORMAT),
            "speaker_account": ("gcloud", "iam", "service-accounts", "describe", self.speaker_account, *common, "--format=json(email,disabled)"),
            "project_policy": ("gcloud", "projects", "get-iam-policy", project, *common, "--format=json(bindings,etag)"),
            "speaker_policy": ("gcloud", "run", "services", "get-iam-policy", speaker, *regional, "--format=json(bindings,etag)"),
        })
        self.allowed_commands = frozenset(self.commands.values())
        self.runner = runner

    def execute(self, command):
        command = tuple(command)
        if command not in self.allowed_commands:
            raise ValueError("Command is outside the read-only allowlist")
        environment = dict(os.environ)
        environment.update({
            "CLOUDSDK_CORE_DISABLE_PROMPTS": "1",
            "CLOUDSDK_CORE_DISABLE_FILE_LOGGING": "1",
            "CLOUDSDK_CORE_LOG_HTTP": "false",
            "CLOUDSDK_CORE_VERBOSITY": "error",
        })
        try:
            # CreateProcess does not apply PowerShell's command resolution or
            # PATHEXT to a bare 'gcloud'. Resolve the installed Windows launcher
            # only after the entire logical query passed the exact allowlist.
            invocation = command
            if os.name == "nt":
                executable = shutil.which("gcloud.cmd")
                if not executable:
                    raise FileNotFoundError("gcloud.cmd")
                invocation = (executable, *command[1:])
            result = self.runner(invocation, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                                 stderr=subprocess.PIPE, text=True, timeout=30, check=False,
                                 env=environment, shell=False)
        except FileNotFoundError:
            raise ReadFailure("gcloud_unavailable") from None
        except subprocess.TimeoutExpired:
            raise ReadFailure("timeout") from None
        except OSError:
            raise ReadFailure("command_failed") from None
        if result.returncode:
            # Classify only; never return stderr, which may contain credentials or IAM data.
            error = (result.stderr or "").upper()
            if "PERMISSION_DENIED" in error or "403" in error:
                code = "permission_denied"
            elif "UNAUTHENTICATED" in error or "NO ACTIVE ACCOUNT" in error or "LOGIN" in error:
                code = "authentication_required"
            elif "NOT_FOUND" in error or "404" in error:
                code = "not_found_or_not_visible"
            else:
                code = "command_failed"
            raise ReadFailure(code)
        try:
            data = json.loads(result.stdout)
        except (json.JSONDecodeError, TypeError):
            raise ReadFailure("invalid_response") from None
        if not isinstance(data, dict):
            raise ReadFailure("invalid_response")
        return data

    def read(self, name):
        if name not in self.commands:
            raise ValueError("Unknown read-only query")
        return self.execute(self.commands[name])


def service_state(document, expected_name):
    metadata = document["metadata"]
    spec = document["spec"]["template"]["spec"]
    status = document["status"]
    if metadata["name"] != expected_name or not isinstance(spec["serviceAccountName"], str):
        raise ValueError("Invalid service metadata")
    annotations = metadata.get("annotations", {})
    if not isinstance(annotations, dict):
        raise ValueError("Invalid annotations")
    disabled = annotations.get(INVOKER_ANNOTATION, "false")
    if disabled not in ("true", "false", True, False):
        raise ValueError("Invalid invoker state")
    # gcloud may omit this projection when no explicit environment entries exist.
    # Backend prerequisites below still fail if their names are absent.
    containers = spec.get("containers", [])
    if not isinstance(containers, list):
        raise ValueError("Invalid container metadata")
    names = set()
    for container in containers:
        if not isinstance(container, dict):
            raise ValueError("Invalid container metadata")
        for entry in container.get("env", []):
            if not isinstance(entry, dict) or set(entry) != {"name"}:
                raise ValueError("Environment projection contains unexpected fields")
            name = entry["name"]
            if not isinstance(name, str):
                raise ValueError("Invalid environment name")
            names.add(name)
    revision = status["latestReadyRevisionName"]
    created = status["latestCreatedRevisionName"]
    if not isinstance(revision, str) or not isinstance(created, str):
        raise ValueError("Invalid revision metadata")
    traffic = status.get("traffic", [])
    if not isinstance(traffic, list):
        raise ValueError("Invalid traffic metadata")
    active = []
    for item in traffic:
        percent = item.get("percent", 0)
        if type(percent) is not int or not 0 <= percent <= 100:
            raise ValueError("Invalid traffic percentage")
        if percent:
            active.append((item.get("revisionName"), percent))
    current = (bool(re.fullmatch(re.escape(expected_name) + r"-[a-z0-9-]+", revision))
               and revision == created and sum(percent for _, percent in active) == 100
               and all(name == revision for name, _ in active))
    return {"account": spec["serviceAccountName"], "env_names": names,
            "invoker_enabled": disabled in ("false", False), "current": current}


def policy_bindings(document):
    # A successful empty policy still has an etag. An empty/misprojected response
    # must not masquerade as proof that no permissions exist.
    if not isinstance(document.get("etag"), str) or not document["etag"]:
        raise ValueError("Missing policy etag")
    bindings = document.get("bindings", [])
    if not isinstance(bindings, list):
        raise ValueError("Invalid IAM bindings")
    for binding in bindings:
        if not isinstance(binding, dict) or not isinstance(binding.get("role"), str):
            raise ValueError("Invalid IAM role")
        members = binding.get("members")
        if not isinstance(members, list) or not all(isinstance(member, str) for member in members):
            raise ValueError("Invalid IAM members")
        if "condition" in binding and not isinstance(binding["condition"], dict):
            raise ValueError("Invalid IAM condition")
    return bindings


def check_readiness(reader):
    reads, values, checks = {}, {}, {}
    for name in reader.commands:
        try:
            data = reader.read(name)
            if name.endswith("_service"):
                expected = reader.backend if name == "backend_service" else reader.speaker
                values[name] = service_state(data, expected)
            elif name.endswith("_policy"):
                values[name] = policy_bindings(data)
            else:
                if not isinstance(data.get("email"), str) or type(data.get("disabled", False)) is not bool:
                    raise ValueError("Invalid account metadata")
                values[name] = data
            reads[name] = "read"
        except ReadFailure as error:
            reads[name] = str(error)
        except (AttributeError, KeyError, TypeError, ValueError):
            reads[name] = "invalid_response"

    def record(name, dependencies, predicate):
        if not all(dependency in values for dependency in dependencies):
            checks[name] = "unverified"
        else:
            checks[name] = "verified" if predicate() else "blocked"

    expected_account = reader.speaker_account
    record("speaker_account_exists_and_enabled", ["speaker_account"],
           lambda: values["speaker_account"]["email"] == expected_account and not values["speaker_account"].get("disabled", False))
    record("backend_identity_is_separate", ["backend_service"],
           lambda: re.fullmatch(r"[a-z][a-z0-9-]*@" + re.escape(reader.project) + r"\.iam\.gserviceaccount\.com", values["backend_service"]["account"]) is not None
           and values["backend_service"]["account"] != expected_account)
    record("speaker_uses_dedicated_identity", ["speaker_service"],
           lambda: values["speaker_service"]["account"] == expected_account)
    for name in ("backend_service", "speaker_service"):
        record(name + "_serves_current_ready_revision", [name], lambda name=name: values[name]["current"])
    for name in REQUIRED_BACKEND_ENV:
        record("backend_env_" + name + "_present", ["backend_service"],
               lambda name=name: name in values["backend_service"]["env_names"])
    record("speaker_invoker_iam_check_enabled", ["speaker_service"],
           lambda: values["speaker_service"]["invoker_enabled"])
    record("speaker_has_no_project_role_bindings", ["project_policy"],
           lambda: all("serviceAccount:" + expected_account not in item["members"] for item in values["project_policy"]))
    for name in ("project_policy", "speaker_policy"):
        record(name + "_has_no_public_bindings", [name],
               lambda name=name: all(not {"allUsers", "allAuthenticatedUsers"}.intersection(item["members"]) for item in values[name]))

    def only_backend_invokes():
        bindings = [item for item in values["speaker_policy"] if item["role"] == "roles/run.invoker"]
        # Conditional grants need separate evaluation; do not report access as verified.
        return (all("condition" not in item for item in bindings)
                and {member for item in bindings for member in item["members"]}
                == {"serviceAccount:" + values["backend_service"]["account"]})

    record("speaker_invoker_binding_is_backend_only", ["backend_service", "speaker_policy"], only_backend_invokes)
    verified = all(state == "verified" for state in checks.values())
    return {
        "schemaVersion": 1,
        "checkedAt": datetime.now(timezone.utc).isoformat(),
        "project": reader.project, "region": reader.region,
        "backendService": reader.backend, "speakerService": reader.speaker,
        "checksPassed": verified,
        "scopeStatus": "verified_within_scope" if verified else "blocked_or_unverified",
        "releaseApproved": False,
        "reads": reads, "checks": checks,
        "notVerified": [
            "Inherited organization/folder IAM and permissions on other resources",
            "Secret values, secret access, and correctness of environment values",
            "That the backend speaker URL points to the inspected service",
            "Authenticated invocation, voice calibration, and deployed image vulnerability status",
            "GitHub environment configuration, release signing, and production promotion",
        ],
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("project", "region", "backend-service", "speaker-service"):
        parser.add_argument("--" + name, required=True)
    args = parser.parse_args(argv)
    try:
        reader = CloudReader(args.project, args.region, args.backend_service, args.speaker_service)
    except ValueError as error:
        parser.error(str(error))
    report = check_readiness(reader)
    print(json.dumps(report, indent=2, sort_keys=True))
    return 0 if report["checksPassed"] else 1


if __name__ == "__main__":
    sys.exit(main())
