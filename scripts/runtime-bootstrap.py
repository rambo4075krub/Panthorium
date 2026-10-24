"""One-time PR 274 identity migration using the existing deployment principal."""
import base64
import copy
import importlib.util
import io
import json
import math
from pathlib import Path
import struct
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
        urllib.request.build_opener(r.NoRedirect()).open(url + "/health", timeout=30)
    except urllib.error.HTTPError as error:
        r.require(error.code in (401, 403, 404), "Unexpected unauthenticated response")
        return
    raise ValueError("Unauthenticated speaker invocation succeeded")


def main():
    with tempfile.TemporaryDirectory() as directory:
        release = Bootstrap(P, "panthorium-staging", "asia-southeast1", "panthorium-speaker", "panthorium-backend", directory)
        before = {name: release.service(name) for name in EXPECTED}
        for name, document in before.items():
            r.require(r.serving_revision(document, name) == EXPECTED[name], "Production revision changed since approved review")
            r.require(document["spec"]["template"]["spec"]["serviceAccountName"] == OLD, "Unexpected existing identity")
        release.backend_identity = B
        release.speaker_url = before[release.speaker]["status"]["url"]
        release.backend_url = before[release.backend]["status"]["url"]
        policy = release.policy()
        callers = {m for binding in policy.get("bindings", []) if binding["role"] == "roles/run.invoker" for m in binding["members"]}
        r.require(callers == {"serviceAccount:" + OLD, "serviceAccount:" + B}, "Unexpected speaker callers before migration")
        v.verify_identity(P, S, B, release.gcloud(["iam", "service-accounts", "describe", S]),
                          release.gcloud(["projects", "get-iam-policy", P]))
        r.health(release.speaker_url, release.token(), speaker=True)
        inference(release.speaker_url, release.token())
        r.health(release.backend_url, backend=True)
        private(release.speaker_url)
        print("Existing deployment identity, private access, health and synthetic inference passed", flush=True)
        removed_old = False
        candidates = {}
        try:
            for name, identity in ((release.backend, B), (release.speaker, S)):
                current = release.service(name)
                r.require(current["spec"] == before[name]["spec"] and r.serving_revision(current, name) == EXPECTED[name],
                          "Concurrent service change before candidate")
                revision = release.gcloud(["run", "revisions", "describe", EXPECTED[name], "--region=asia-southeast1"])
                image = r.immutable_image(revision["status"]["imageDigest"])
                tag = "iam-pr274"
                document = release.gcloud(["run", "services", "update", name, "--region=asia-southeast1",
                                           "--image=" + image, "--service-account=" + identity, "--no-traffic", "--tag=" + tag])
                current, revision, url = release.candidate(name, document, image, tag, before[name]["status"]["url"], EXPECTED[name])
                unchanged(before[name], current, identity, image)
                candidates[name] = (revision, url, identity, image)
                if name == release.backend:
                    r.health(url, backend=True)
                else:
                    r.health(url, release.token(), speaker=True)
                    inference(url, release.token())
                    private(url)
                print("No-traffic candidate verified: " + name + " " + revision, flush=True)
            for name, (revision, url, identity, image) in candidates.items():
                release.promotion_guard(name, revision, EXPECTED[name])
                unchanged(before[name], release.service(name), identity, image)
            for name in (release.backend, release.speaker):
                revision = candidates[name][0]
                release.promotion_guard(name, revision, EXPECTED[name])
                release.route(name, revision)
                if name == release.backend:
                    r.health(release.backend_url, backend=True)
                else:
                    r.health(release.speaker_url, release.token(), speaker=True)
                    inference(release.speaker_url, release.token())
                print("Production identity verified: " + name, flush=True)
            removed_old = True
            release.gcloud(["run", "services", "remove-iam-policy-binding", release.speaker, "--region=asia-southeast1",
                            "--member=serviceAccount:" + OLD, "--role=roles/run.invoker"])
            release.preflight()
            private(release.speaker_url)
            print(json.dumps({"status": "verified", "backendRevision": candidates[release.backend][0],
                              "speakerRevision": candidates[release.speaker][0], "backendIdentity": B,
                              "speakerIdentity": S, "speakerProjectRoles": 0, "speakerCallers": [B]}), flush=True)
        except Exception:
            if removed_old:
                release.gcloud(["run", "services", "add-iam-policy-binding", release.speaker, "--region=asia-southeast1",
                                "--member=serviceAccount:" + OLD, "--role=roles/run.invoker"])
            release.rollback()
            r.health(release.backend_url, backend=True)
            raise ValueError("Identity migration failed; previous production traffic restored or unchanged") from None


if __name__ == "__main__":
    main()
