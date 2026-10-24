"""One-time PR 274 identity migration using the existing deployment principal."""
import base64
import copy
import importlib.util
import io
import json
import math
from pathlib import Path
import struct
import subprocess
import tempfile
import urllib.error
import urllib.request
import wave


def module(name, file):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(file))
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


r = module("release", "speaker-production-release.py")
v = module("verify", "verify-speaker-deployment.py")
P = "project-0f6aa7d0-6055-420f-842"
B = "backend-runtime@" + P + ".iam.gserviceaccount.com"
S = "speaker-runtime@" + P + ".iam.gserviceaccount.com"
OLD = "699017940678-compute@developer.gserviceaccount.com"
EXPECTED = {"panthorium-backend": "panthorium-backend-00150-jox",
            "panthorium-speaker": "panthorium-speaker-00001-vj6"}


class Bootstrap(r.Release):
    def command(self, args):
        if args[1:3] == ["projects", "get-iam-policy"]:
            result = subprocess.run(args, capture_output=True, text=True)
            if result.returncode:
                print(result.stderr, flush=True)
                raise ValueError("Project IAM readiness read failed")
            return result.stdout.strip()
        return super().command(args)

    def verify(self, mode, first, second, *documents):
        if mode == "identity":
            v.verify_identity(P, first, second, *documents)
        elif mode == "service":
            v.verify_service(first, second, *documents)
        else:
            return v.verify_candidate(first, *documents, expected_image=second)
        return "verified"


def unchanged(before, after, identity, image):
    expected = copy.deepcopy(before["spec"]["template"]["spec"])
    expected["serviceAccountName"] = identity
    expected["containers"][0]["image"] = image
    actual = copy.deepcopy(after["spec"]["template"]["spec"])
    for obj in (expected, actual):
        for container in obj["containers"]:
            if "env" in container:
                container["env"].sort(key=lambda item: item["name"])
    r.require(expected == actual, "Unrelated runtime configuration changed")
    for field, generated in (("annotations", {"run.googleapis.com/client-name", "run.googleapis.com/client-version"}),
                             ("labels", {"client.knative.dev/nonce"})):
        values = [{k: val for k, val in doc["spec"]["template"]["metadata"].get(field, {}).items()
                   if k not in generated} for doc in (before, after)]
        r.require(values[0] == values[1], "Unrelated revision metadata changed")


def inference(url, token):
    r.cloud_url(url)
    raw = io.BytesIO()
    with wave.open(raw, "wb") as wav:
        wav.setparams((1, 2, 16000, 0, "NONE", "not compressed"))
        wav.writeframes(b"".join(struct.pack("<h", int(5000 * math.sin(2 * math.pi * 220 * i / 16000)
                                                     + 1800 * math.sin(2 * math.pi * 370 * i / 16000)))
                                 for i in range(48000)))
    body = json.dumps({"audio": "data:audio/wav;base64," + base64.b64encode(raw.getvalue()).decode()}).encode()
    request = urllib.request.Request(url + "/embed", data=body,
                                     headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"})
    with urllib.request.build_opener(r.NoRedirect()).open(request, timeout=60) as response:
        result = json.load(response)
    vector = result.get("embedding", [])
    r.require(result.get("signalPresent") is True and len(vector) == 192
              and all(isinstance(x, (int, float)) and math.isfinite(x) for x in vector),
              "Synthetic speaker inference failed")


def private(url):
    try:
        urllib.request.build_opener(r.NoRedirect()).open(urllib.request.Request(url + "/embed", data=b"{}", headers={"Content-Type": "application/json"}), timeout=30)
    except urllib.error.HTTPError as error:
        r.require(error.code in (401, 403), "Unexpected unauthenticated response")
        return
    raise ValueError("Unauthenticated speaker invocation succeeded")


def main():
    # Resume only the two known no-traffic candidates from the prior attempt.
    known = {"panthorium-backend": "panthorium-backend-00152-jez", "panthorium-speaker": "panthorium-speaker-00002-buv"}
    with tempfile.TemporaryDirectory() as directory:
        release = Bootstrap(P, "panthorium-staging", "asia-southeast1", "panthorium-speaker", "panthorium-backend", directory)
        before = {name: release.service(name) for name in EXPECTED}
        images = {}
        for name, current in before.items():
            r.require(current["status"]["latestCreatedRevisionName"] == known[name]
                      and current["status"]["latestReadyRevisionName"] == known[name]
                      and r.traffic(current) == {EXPECTED[name]: 100}, "Concurrent production change")
            original = release.gcloud(["run", "revisions", "describe", EXPECTED[name], "--region=asia-southeast1"])
            images[name] = r.immutable_image(original["status"]["imageDigest"])
            expected = copy.deepcopy(original["spec"])
            actual = copy.deepcopy(current["spec"]["template"]["spec"])
            expected["serviceAccountName"] = B if name == release.backend else S
            expected["containers"][0]["image"] = images[name]
            for spec in (expected, actual):
                r.require(len(spec["containers"]) == 1, "Unexpected container count")
                spec["containers"][0].pop("name", None)  # Generated single-container revision name.
                if "env" in spec["containers"][0]:
                    spec["containers"][0]["env"].sort(key=lambda item: item["name"])
            r.require(expected == actual, "Candidate changed original runtime configuration")
        release.backend_identity = B
        release.speaker_url = before[release.speaker]["status"]["url"]
        release.backend_url = before[release.backend]["status"]["url"]
        v.verify_identity(P, S, B, release.gcloud(["iam", "service-accounts", "describe", S]),
                          release.gcloud(["projects", "get-iam-policy", P]))
        callers = {m for binding in release.policy().get("bindings", []) if binding["role"] == "roles/run.invoker" for m in binding["members"]}
        r.require(callers == {"serviceAccount:" + OLD, "serviceAccount:" + B}, "Unexpected Speaker callers")
        r.speaker_inference(release.speaker_url, release.token())
        r.health(release.backend_url, backend=True)
        private(release.speaker_url)
        removed_old = False
        candidates = {}
        try:
            # Reattach the tested backend candidate without changing its template.
            document = release.gcloud(["run", "services", "update-traffic", release.backend, "--region=asia-southeast1",
                                       "--update-tags=iam-pr274=" + known[release.backend]])
            current, revision, url = release.candidate(release.backend, document, images[release.backend], "iam-pr274",
                                                       release.backend_url, EXPECTED[release.backend])
            unchanged(before[release.backend], current, B, images[release.backend])
            r.health(url, backend=True)
            candidates[release.backend] = (revision, url)
            print("Reused verified backend candidate: " + revision, flush=True)
            # The CLI injected maxScale=10 into the console-created Speaker's
            # revision. Preserve its original absence through an exact service
            # replacement; the existing service-level cap remains unchanged.
            current = release.service(release.speaker)
            r.require(current["spec"] == before[release.speaker]["spec"], "Speaker changed before exact replacement")
            metadata = current["spec"]["template"]["metadata"]
            r.require(metadata["annotations"].get("autoscaling.knative.dev/maxScale") == "10", "Unexpected injected scaling value")
            expected_speaker = copy.deepcopy(before[release.speaker])
            expected_speaker["spec"]["template"]["metadata"]["annotations"].pop("autoscaling.knative.dev/maxScale")
            desired = copy.deepcopy(current)
            desired.pop("status", None)
            allowed_metadata = {"name", "namespace", "resourceVersion", "labels", "annotations"}
            desired["metadata"] = {k: val for k, val in desired["metadata"].items() if k in allowed_metadata}
            for key in ("run.googleapis.com/operation-id", "run.googleapis.com/urls", "run.googleapis.com/ingress-status",
                        "serving.knative.dev/creator", "serving.knative.dev/lastModifier"):
                desired["metadata"].get("annotations", {}).pop(key, None)
            desired["spec"]["template"]["metadata"]["annotations"].pop("autoscaling.knative.dev/maxScale")
            candidate_name = "panthorium-speaker-iam274-v2"
            desired["spec"]["template"]["metadata"]["name"] = candidate_name
            desired["spec"]["traffic"] = [entry for entry in desired["spec"]["traffic"] if entry.get("tag") != "iam-pr274"]
            r.require(not any(entry.get("latestRevision") for entry in desired["spec"]["traffic"]), "Traffic must reference explicit revisions")
            desired["spec"]["traffic"].append({"revisionName": candidate_name, "tag": "iam-pr274", "percent": 0})
            manifest = Path(directory) / "speaker-identity.json"
            manifest.write_text(json.dumps(desired), encoding="utf8")
            manifest.chmod(0o600)
            document = release.gcloud(["run", "services", "replace", str(manifest), "--region=asia-southeast1"])
            manifest.unlink()
            current, revision, url = release.candidate(release.speaker, document, images[release.speaker], "iam-pr274",
                                                       release.speaker_url, EXPECTED[release.speaker])
            unchanged(expected_speaker, current, S, images[release.speaker])
            for key, value in before[release.speaker]["metadata"].get("annotations", {}).items():
                if key not in {"run.googleapis.com/operation-id", "run.googleapis.com/urls", "run.googleapis.com/ingress-status",
                               "serving.knative.dev/creator", "serving.knative.dev/lastModifier",
                               "run.googleapis.com/client-name", "run.googleapis.com/client-version"}:
                    r.require(current["metadata"].get("annotations", {}).get(key) == value, "Unrelated service metadata changed")
            r.speaker_inference(url, release.token())
            private(url)
            candidates[release.speaker] = (revision, url)
            print("Speaker candidate preserves original scaling and passed inference: " + revision, flush=True)
            for name, (revision, url) in candidates.items():
                release.promotion_guard(name, revision, EXPECTED[name])
            for name in (release.backend, release.speaker):
                revision = candidates[name][0]
                release.promotion_guard(name, revision, EXPECTED[name])
                release.route(name, revision)
                if name == release.backend:
                    r.health(release.backend_url, backend=True)
                else:
                    r.speaker_inference(release.speaker_url, release.token())
                print("Production identity verified: " + name, flush=True)
            removed_old = True
            release.gcloud(["run", "services", "remove-iam-policy-binding", release.speaker, "--region=asia-southeast1",
                            "--member=serviceAccount:" + OLD, "--role=roles/run.invoker"])
            release.preflight()
            private(release.speaker_url)
            print(json.dumps({"status": "verified", "backendRevision": candidates[release.backend][0],
                              "speakerRevision": candidates[release.speaker][0], "backendIdentity": B,
                              "speakerIdentity": S, "speakerProjectRoles": 0, "speakerCallers": [B]}), flush=True)
        except Exception as error:
            print("Bootstrap stopped: " + (str(error) if isinstance(error, ValueError) else type(error).__name__), flush=True)
            if removed_old:
                release.gcloud(["run", "services", "add-iam-policy-binding", release.speaker, "--region=asia-southeast1",
                                "--member=serviceAccount:" + OLD, "--role=roles/run.invoker"])
            release.rollback()
            r.health(release.backend_url, backend=True)
            raise ValueError("Identity migration failed; previous production traffic restored or unchanged") from None


if __name__ == "__main__":
    main()
