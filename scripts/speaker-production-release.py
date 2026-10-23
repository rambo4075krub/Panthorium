"""Guarded production speaker rollout; no IAM writes and no implicit bootstrap."""
import copy
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request


VERIFY = Path(__file__).with_name("verify-speaker-deployment.py")


def require(condition, message):
    if not condition:
        raise ValueError(message)


def production_project(project, staging_project):
    require(re.fullmatch(r"[a-z][a-z0-9-]{4,28}[a-z0-9]", project) is not None,
            "Production project ID is required")
    require(project != staging_project and "staging" not in project,
            "Production speaker must use a distinct production project")


def single_container(service):
    containers = service.get("spec", {}).get("template", {}).get("spec", {}).get("containers", [])
    require(len(containers) == 1, "Exactly one application container is required")
    return containers[0]


def ready(service):
    require(any(item.get("type") == "Ready" and str(item.get("status")).lower() == "true"
                for item in service.get("status", {}).get("conditions", [])), "Service is not ready")


def traffic(service):
    result = {}
    for item in service.get("status", {}).get("traffic", []):
        percent = item.get("percent", 0)
        require(isinstance(percent, int) and not isinstance(percent, bool) and 0 <= percent <= 100,
                "Invalid service traffic")
        if percent:
            revision = item.get("revisionName", "")
            require(re.fullmatch(r"[a-z][a-z0-9-]+", revision) is not None, "Unresolved traffic revision")
            require(revision not in result, "Duplicate serving revision")
            result[revision] = percent
    require(sum(result.values()) == 100, "Traffic must resolve to 100 percent")
    return result


def serving_revision(service, name):
    ready(service)
    require(service.get("metadata", {}).get("name") == name, "Unexpected service")
    revision = service.get("status", {}).get("latestReadyRevisionName", "")
    require(re.fullmatch(re.escape(name) + r"-[a-z0-9-]+", revision) is not None, "Missing ready revision")
    require(service.get("status", {}).get("latestCreatedRevisionName") == revision,
            "An unready revision requires review")
    require(traffic(service) == {revision: 100}, "Existing traffic must use the latest ready revision only")
    single_container(service)
    return revision


def cloud_url(value):
    parsed = urllib.parse.urlsplit(value)
    require(parsed.scheme == "https" and parsed.hostname is not None
            and parsed.netloc == parsed.hostname and parsed.hostname.endswith(".run.app")
            and re.fullmatch(r"[a-z0-9.-]+", parsed.hostname) is not None
            and not parsed.path and not parsed.query and not parsed.fragment,
            "Expected a canonical HTTPS Cloud Run URL")
    return parsed.hostname


def tagged_url(service, tag, revision, canonical):
    host = cloud_url(canonical)
    entries = [item for item in service.get("status", {}).get("traffic", []) if item.get("tag") == tag]
    require(len(entries) == 1 and entries[0].get("revisionName") == revision,
            "Candidate traffic tag does not identify the verified revision")
    value = entries[0].get("url", "")
    require(cloud_url(value) == tag + "---" + host, "Candidate URL does not belong to the verified service")
    return value


def immutable_image(value):
    require(re.fullmatch(r"[a-z0-9][a-z0-9./_-]*@sha256:[0-9a-f]{64}", value or "") is not None,
            "Image must use an immutable SHA-256 digest")
    return value


def backend_identity(service, project):
    identity = service.get("spec", {}).get("template", {}).get("spec", {}).get("serviceAccountName", "")
    require(re.fullmatch(r"[a-z][a-z0-9-]*@" + re.escape(project) + r"\.iam\.gserviceaccount\.com", identity) is not None,
            "Existing backend must have an explicit production service identity")
    env = {item.get("name"): item for item in single_container(service).get("env", [])}
    require("BIOMETRIC_SPEAKER_TOKEN" not in env or env["BIOMETRIC_SPEAKER_TOKEN"] == {"name": "BIOMETRIC_SPEAKER_TOKEN", "value": ""},
            "Backend must use its Google identity for speaker requests")
    require(env.get("BIOMETRIC_GATE_ENABLED", {}).get("value") == "1" and "BIOMETRIC_TEMPLATE_KEY" in env,
            "Existing production Voice Identity configuration is required")
    return identity


def unchanged_backend(before, after, image, speaker_url):
    expected = copy.deepcopy(before.get("spec", {}).get("template", {}).get("spec", {}))
    container = expected["containers"][0]
    container["image"] = image
    container["env"] = [item for item in container.get("env", []) if item.get("name") != "BIOMETRIC_SPEAKER_URL"]
    container["env"].append({"name": "BIOMETRIC_SPEAKER_URL", "value": speaker_url})
    actual = copy.deepcopy(after.get("spec", {}).get("template", {}).get("spec", {}))
    # Cloud Run may reorder environment entries without changing their meaning.
    for spec in (expected, actual):
        require(len(spec.get("containers", [])) == 1, "Unexpected backend container change")
        entries = spec["containers"][0].get("env", [])
        require(len({entry.get("name") for entry in entries}) == len(entries), "Duplicate backend environment variable")
        spec["containers"][0]["env"] = sorted(entries, key=lambda entry: entry.get("name", ""))
    require(actual == expected, "Backend association changed unrelated configuration")
    # Cloud SQL, VPC/egress and scaling settings also live in revision metadata.
    # Only gcloud's own client identity/version and nonce may differ.
    for field, generated in (("annotations", {"run.googleapis.com/client-name", "run.googleapis.com/client-version"}),
                             ("labels", {"client.knative.dev/nonce"})):
        values = []
        for service in (before, after):
            metadata = service.get("spec", {}).get("template", {}).get("metadata", {})
            values.append({key: value for key, value in metadata.get(field, {}).items() if key not in generated})
        require(values[0] == values[1], "Backend association changed unrelated revision metadata")


def rollback_allowed(current, candidate, previous):
    status = current.get("status", {})
    require(status.get("latestCreatedRevisionName") == candidate and status.get("latestReadyRevisionName") == candidate,
            "Concurrent revision detected; automatic rollback refused")
    current_traffic = traffic(current)
    require(current_traffic in ({previous: 100}, {candidate: 100}),
            "Concurrent traffic change detected; automatic rollback refused")
    return current_traffic == {candidate: 100}


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, newurl):
        raise ValueError("Health checks must not redirect")


def health(url, token=None, speaker=False, backend=False):
    # Caller validates both canonical and tagged origins before any token is used.
    cloud_url(url)
    headers = {"Authorization": "Bearer " + token} if token else {}
    opener = urllib.request.build_opener(NoRedirect())
    for attempt in range(6):
        try:
            endpoints = ("/health", "/api/health") if backend else ("/health",)
            for endpoint in endpoints:
                with opener.open(urllib.request.Request(url + endpoint, headers=headers), timeout=20) as response:
                    require(response.status == 200, "Health endpoint did not succeed")
                    data = response.read(65537)
                require(len(data) <= 65536, "Health response exceeded the limit")
                payload = json.loads(data)
                require(isinstance(payload, dict) and payload.get("ok") is True, "Health endpoint is not ready")
                if speaker:
                    require(payload.get("modelReady") is True, "Speaker model is not ready")
                if endpoint == "/api/health":
                    require(payload.get("voiceIdentityConfigured") is True and payload.get("voiceIdentityGateEnabled") is True,
                            "Backend Voice Identity is not ready")
            return
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError):
            if attempt == 5:
                raise ValueError("Cloud Run health request failed") from None
            time.sleep(3)


class Release:
    def __init__(self, project, staging_project, region, speaker, backend, directory):
        production_project(project, staging_project)
        require(region == "asia-southeast1", "Unexpected production region")
        require(speaker == "panthorium-speaker" and backend == "panthorium-backend", "Unexpected production service names")
        self.project, self.region, self.speaker, self.backend = project, region, speaker, backend
        self.directory = Path(directory)
        self.speaker_identity = f"speaker-runtime@{project}.iam.gserviceaccount.com"
        self.candidates = {}

    def command(self, args):
        result = subprocess.run(args, capture_output=True, text=True, check=False)
        if result.returncode:
            # Cloud errors and service JSON may contain configuration values.
            raise ValueError("Required cloud operation failed; inspect access and service configuration securely")
        return result.stdout.strip()

    def gcloud(self, args, json_output=True):
        output = self.command(["gcloud", *args, f"--project={self.project}", "--quiet", *( ["--format=json"] if json_output else [])])
        return json.loads(output) if json_output else output

    def service(self, name):
        return self.gcloud(["run", "services", "describe", name, f"--region={self.region}"])

    def policy(self):
        return self.gcloud(["run", "services", "get-iam-policy", self.speaker, f"--region={self.region}"])

    def verify(self, mode, first, second, *documents):
        paths = []
        for index, document in enumerate(documents):
            path = self.directory / f"{mode}-{index}.json"
            path.write_text(json.dumps(document), encoding="utf8")
            path.chmod(0o600)
            paths.append(str(path))
        return self.command([sys.executable, str(VERIFY), mode, first, second, *paths])

    def token(self):
        token = self.gcloud(["auth", "print-identity-token", f"--impersonate-service-account={self.backend_identity}",
                             f"--audiences={self.speaker_url}", "--include-email"], json_output=False)
        require(len(token) <= 16384 and re.fullmatch(r"[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+", token) is not None,
                "Identity token was not returned")
        if os.environ.get("GITHUB_ACTIONS") == "true":
            print("::add-mask::" + token, flush=True)
        return token

    def preflight(self):
        self.before_backend, self.before_speaker = self.service(self.backend), self.service(self.speaker)
        self.previous_backend = serving_revision(self.before_backend, self.backend)
        self.previous_speaker = serving_revision(self.before_speaker, self.speaker)
        self.backend_identity = backend_identity(self.before_backend, self.project)
        self.speaker_url = self.before_speaker.get("status", {}).get("url", "")
        self.backend_url = self.before_backend.get("status", {}).get("url", "")
        cloud_url(self.speaker_url)
        cloud_url(self.backend_url)
        account = self.gcloud(["iam", "service-accounts", "describe", self.speaker_identity])
        project_policy = self.gcloud(["projects", "get-iam-policy", self.project])
        self.verify("identity", self.speaker_identity, self.backend_identity, account, project_policy)
        self.verify("service", self.speaker_identity, self.backend_identity, self.before_speaker, self.policy())
        revision = self.gcloud(["run", "revisions", "describe", self.previous_backend, f"--region={self.region}"])
        require(revision.get("metadata", {}).get("name") == self.previous_backend, "Unexpected backend revision")
        self.backend_image = immutable_image(revision.get("status", {}).get("imageDigest", ""))
        health(self.speaker_url, self.token(), speaker=True)
        health(self.backend_url, backend=True)

    def candidate(self, name, document, image, tag, canonical, previous):
        revision = document.get("status", {}).get("latestCreatedRevisionName", "")
        require(re.fullmatch(re.escape(name) + r"-[a-z0-9-]+", revision) is not None, "Missing deployed candidate identity")
        # Track our own deployment before checking image/readiness/traffic, so a
        # subsequent failed check can still restore any changed serving traffic.
        self.candidates[name] = {"revision": revision, "previous": previous, "tag": tag}
        current = self.service(name)
        require(self.verify("candidate-image", name, image, document, current) == revision,
                "Unexpected verified candidate identity")
        ready(current)
        require(traffic(current) == {previous: 100}, "Candidate deployment changed serving traffic")
        url = tagged_url(current, tag, revision, canonical)
        return current, revision, url

    def promotion_guard(self, name, revision, previous):
        current = self.service(name)
        ready(current)
        require(current.get("status", {}).get("latestCreatedRevisionName") == revision
                and current.get("status", {}).get("latestReadyRevisionName") == revision,
                "Candidate changed before traffic update")
        require(traffic(current) == {previous: 100}, "Traffic changed before traffic update")

    def route(self, name, revision):
        self.gcloud(["run", "services", "update-traffic", name, f"--region={self.region}", f"--to-revisions={revision}=100"])
        require(traffic(self.service(name)) == {revision: 100}, "Traffic update was not confirmed")

    def rollback(self):
        # Restore the backend first; never undo the speaker underneath a backend
        # whose traffic cannot be confidently restored.
        for name in (self.backend, self.speaker):
            state = self.candidates.get(name)
            if not state:
                continue
            current = self.service(name)
            if rollback_allowed(current, state["revision"], state["previous"]):
                self.route(name, state["previous"])
            self.gcloud(["run", "services", "update-traffic", name, f"--region={self.region}",
                         f"--remove-tags={state['tag']}"])

    def rollout(self, image, run_id):
        immutable_image(image)
        require(image.startswith(f"{self.region}-docker.pkg.dev/{self.project}/panthorium/speaker@sha256:"),
                "Speaker image must belong to the production registry")
        require(re.fullmatch(r"[0-9]+-[0-9]+", run_id) is not None, "Workflow run identity is required")
        self.preflight()
        speaker_tag, backend_tag = f"speaker-check-{run_id}", f"speaker-link-{run_id}"
        try:
            document = self.gcloud(["run", "deploy", self.speaker, f"--region={self.region}", f"--image={image}",
                                   f"--service-account={self.speaker_identity}", "--invoker-iam-check", "--memory=2Gi", "--cpu=2",
                                   "--concurrency=2", "--timeout=60", "--min-instances=0", "--max-instances=1",
                                   "--no-traffic", f"--tag={speaker_tag}"])
            speaker_current, speaker_revision, speaker_candidate_url = self.candidate(
                self.speaker, document, image, speaker_tag, self.speaker_url, self.previous_speaker)
            self.verify("service", self.speaker_identity, self.backend_identity, speaker_current, self.policy())
            health(speaker_candidate_url, self.token(), speaker=True)
            # Avoid updating a template modified by another operator since preflight.
            backend_current = self.service(self.backend)
            require(serving_revision(backend_current, self.backend) == self.previous_backend
                    and backend_current.get("spec") == self.before_backend.get("spec"), "Backend changed during speaker verification")
            document = self.gcloud(["run", "services", "update", self.backend, f"--region={self.region}",
                                   f"--image={self.backend_image}", f"--update-env-vars=BIOMETRIC_SPEAKER_URL={self.speaker_url}",
                                   "--no-traffic", f"--tag={backend_tag}"])
            backend_current, backend_revision, backend_candidate_url = self.candidate(
                self.backend, document, self.backend_image, backend_tag, self.backend_url, self.previous_backend)
            unchanged_backend(self.before_backend, backend_current, self.backend_image, self.speaker_url)
            health(backend_candidate_url, backend=True)
            # Recheck policies, exact revision/image, and both old traffic maps
            # immediately before the first production traffic mutation.
            speaker_current = self.service(self.speaker)
            self.verify("candidate-image", self.speaker, image, speaker_current, self.service(self.speaker))
            require(speaker_current.get("status", {}).get("latestReadyRevisionName") == speaker_revision,
                    "Speaker candidate changed before promotion")
            self.verify("service", self.speaker_identity, self.backend_identity, speaker_current, self.policy())
            require(traffic(speaker_current) == {self.previous_speaker: 100}, "Speaker traffic changed before promotion")
            backend_current = self.service(self.backend)
            self.verify("candidate-image", self.backend, self.backend_image, backend_current, self.service(self.backend))
            require(backend_current.get("status", {}).get("latestReadyRevisionName") == backend_revision,
                    "Backend candidate changed before promotion")
            unchanged_backend(self.before_backend, backend_current, self.backend_image, self.speaker_url)
            require(traffic(backend_current) == {self.previous_backend: 100}, "Backend traffic changed before promotion")
            self.promotion_guard(self.speaker, speaker_revision, self.previous_speaker)
            self.route(self.speaker, speaker_revision)
            health(self.speaker_url, self.token(), speaker=True)
            health(backend_candidate_url, backend=True)
            self.promotion_guard(self.backend, backend_revision, self.previous_backend)
            self.route(self.backend, backend_revision)
            health(self.backend_url, backend=True)
            receipt = {"project": self.project, "speakerService": self.speaker, "speakerRevision": speaker_revision,
                       "speakerImage": image, "backendService": self.backend, "backendRevision": backend_revision,
                       "backendImage": self.backend_image, "status": "verified"}
            print(json.dumps(receipt, sort_keys=True))
            return receipt
        except Exception:
            try:
                self.rollback()
            except Exception:
                raise ValueError("Rollout failed and rollback could not be verified; production traffic requires operator review") from None
            raise ValueError("Rollout failed; previous production traffic was restored or remained unchanged") from None


def main():
    require(len(sys.argv) in (2, 4) and sys.argv[1] in {"preflight", "rollout"}, "Invalid release command")
    os.umask(0o077)
    with tempfile.TemporaryDirectory(prefix="speaker-release-", dir=os.environ.get("RUNNER_TEMP")) as directory:
        release = Release(os.environ.get("PROJECT", ""), os.environ.get("STAGING_PROJECT", "panthorium-staging"),
                          os.environ.get("REGION", ""), os.environ.get("SERVICE", ""), os.environ.get("BACKEND_SERVICE", ""), directory)
        if sys.argv[1] == "preflight":
            require(len(sys.argv) == 2, "Unexpected preflight arguments")
            release.preflight()
            print("Production speaker identity, existing traffic and authenticated readiness checks passed")
        else:
            require(len(sys.argv) == 4, "Image and workflow run identity are required")
            release.rollout(sys.argv[2], sys.argv[3])


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(str(error) if isinstance(error, ValueError) else "Production speaker verification failed", file=sys.stderr)
        sys.exit(1)
