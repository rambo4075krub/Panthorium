import copy
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch, MagicMock
from contextlib import redirect_stdout


ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("speaker_production_release", ROOT / "scripts/speaker-production-release.py")
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)
PROJECT = "panthorium-production"
BACKEND = "panthorium-backend"
SPEAKER = "panthorium-speaker"
BACKEND_SA = f"backend-runtime@{PROJECT}.iam.gserviceaccount.com"
SPEAKER_SA = f"speaker-runtime@{PROJECT}.iam.gserviceaccount.com"
IMAGE = f"asia-southeast1-docker.pkg.dev/{PROJECT}/panthorium/speaker@sha256:" + "b" * 64
BACKEND_IMAGE = f"asia-southeast1-docker.pkg.dev/{PROJECT}/panthorium/backend@sha256:" + "a" * 64


def service(name):
    backend = name == BACKEND
    revision = name + "-old-001"
    return {"metadata": {"name": name, "annotations": {}},
            "spec": {"template": {"metadata": {"annotations": {"run.googleapis.com/cloudsql-instances": "private-db",
                                                                   "run.googleapis.com/vpc-access-egress": "private-ranges-only",
                                                                   "autoscaling.knative.dev/maxScale": "1"}},
                                    "spec": {"serviceAccountName": BACKEND_SA if backend else SPEAKER_SA,
                                             "containers": [{"image": BACKEND_IMAGE if backend else IMAGE.replace("b" * 64, "c" * 64),
                                                             "env": [{"name": "BIOMETRIC_GATE_ENABLED", "value": "1"},
                                                                     {"name": "BIOMETRIC_TEMPLATE_KEY", "valueFrom": {"secretKeyRef": {"name": "template", "key": "latest"}}},
                                                                     {"name": "UNRELATED_SETTING", "value": "preserve-exactly"}]}]}}},
            "status": {"latestCreatedRevisionName": revision, "latestReadyRevisionName": revision,
                       "conditions": [{"type": "Ready", "status": "True"}],
                       "url": f"https://{name}-abc.asia-southeast1.run.app",
                       "traffic": [{"revisionName": revision, "percent": 100}]}}


class FakeRelease(release.Release):
    def __init__(self, directory):
        super().__init__(PROJECT, "panthorium-staging", "asia-southeast1", SPEAKER, BACKEND, directory)
        self.state = {name: service(name) for name in (BACKEND, SPEAKER)}
        self.calls = []
        self.fail_backend_promotion = False
        self.fail_backend_rollback = False

    def gcloud(self, args, json_output=True):
        self.calls.append(list(args))
        if args[:3] == ["run", "services", "describe"]:
            return copy.deepcopy(self.state[args[3]])
        if args[:3] == ["run", "services", "get-iam-policy"]:
            return {"bindings": [{"role": "roles/run.invoker", "members": [f"serviceAccount:{BACKEND_SA}"]}]}
        if args[:3] == ["iam", "service-accounts", "describe"]:
            return {"email": SPEAKER_SA}
        if args[:2] == ["projects", "get-iam-policy"]:
            return {"bindings": []}
        if args[:3] == ["run", "revisions", "describe"]:
            return {"metadata": {"name": args[3]}, "status": {"imageDigest": BACKEND_IMAGE}}
        if args[:2] == ["run", "deploy"] or args[:3] == ["run", "services", "update"]:
            name = args[2] if args[1] == "deploy" else args[3]
            self.assert_no_traffic(args)
            current = self.state[name]
            revision = name + "-new-002"
            tag = next(arg.split("=", 1)[1] for arg in args if arg.startswith("--tag="))
            image = next(arg.split("=", 1)[1] for arg in args if arg.startswith("--image="))
            current["spec"]["template"]["spec"]["containers"][0]["image"] = image
            if name == BACKEND:
                env = current["spec"]["template"]["spec"]["containers"][0]["env"]
                env[:] = [item for item in env if item["name"] != "BIOMETRIC_SPEAKER_URL"]
                env.append({"name": "BIOMETRIC_SPEAKER_URL", "value": self.speaker_url})
            current["status"]["latestCreatedRevisionName"] = revision
            current["status"]["latestReadyRevisionName"] = revision
            current["status"]["traffic"].append({"revisionName": revision, "percent": 0, "tag": tag,
                                                  "url": "https://" + tag + "---" + release.cloud_url(current["status"]["url"])})
            return copy.deepcopy(current)
        if args[:3] == ["run", "services", "update-traffic"]:
            name = args[3]
            current = self.state[name]
            remove = next((arg.split("=", 1)[1] for arg in args if arg.startswith("--remove-tags=")), None)
            if remove:
                current["status"]["traffic"] = [entry for entry in current["status"]["traffic"] if entry.get("tag") != remove]
                return copy.deepcopy(current)
            target = next(arg.split("=", 1)[1].removesuffix("=100") for arg in args if arg.startswith("--to-revisions="))
            if name == BACKEND and target.endswith("old-001") and self.fail_backend_rollback:
                raise ValueError("Simulated rollback permission failure")
            tags = [{**entry, "percent": 0} for entry in current["status"]["traffic"] if entry.get("tag")]
            current["status"]["traffic"] = [{"revisionName": target, "percent": 100}, *tags]
            if name == BACKEND and target.endswith("new-002") and self.fail_backend_promotion:
                raise ValueError("Simulated ambiguous promotion response after traffic changed")
            return copy.deepcopy(current)
        raise AssertionError("Unexpected cloud operation: " + " ".join(args[:3]))

    @staticmethod
    def assert_no_traffic(args):
        if "--no-traffic" not in args:
            raise AssertionError("Candidate mutation must not route traffic")

    def token(self):
        self.calls.append(["test", "id-token", self.backend_identity, self.speaker_url])
        return "test.identity.token"


class ProductionDeploymentTests(unittest.TestCase):
    def test_synthetic_preflight_requires_real_finite_nonzero_embedding(self):
        url = service(SPEAKER)["status"]["url"]
        response = MagicMock()
        response.__enter__.return_value = response
        response.status = 200
        response.read.return_value = json.dumps({"signalPresent": True, "embedding": [0.1] * 192}).encode()
        opener = MagicMock()
        opener.open.return_value = response
        with patch.object(release.urllib.request, "build_opener", return_value=opener) as build:
            release.speaker_inference(url, "test.identity.token")
            request = opener.open.call_args.args[0]
            self.assertEqual(request.full_url, url + "/embed")
            self.assertEqual(request.get_header("Authorization"), "Bearer test.identity.token")
            self.assertIsInstance(build.call_args.args[0], release.NoRedirect)
            self.assertEqual(opener.open.call_args.kwargs, {"timeout": 60})
            data = json.loads(request.data)["audio"].split(",", 1)[1]
            with release.wave.open(io.BytesIO(release.base64.b64decode(data))) as audio:
                self.assertEqual((audio.getnchannels(), audio.getframerate(), audio.getnframes()), (1, 16000, 48000))
            for result in ({}, {"signalPresent": True, "embedding": [0.0] * 192},
                           {"signalPresent": True, "embedding": [True] * 192},
                           {"signalPresent": True, "embedding": [float("inf")] * 192},
                           {"signalPresent": True, "embedding": [0.1] * 191}):
                response.read.return_value = json.dumps(result).encode()
                with self.assertRaises(ValueError):
                    release.speaker_inference(url, "test.identity.token")
            response.read.return_value = b"x" * 65537
            with self.assertRaises(ValueError):
                release.speaker_inference(url, "test.identity.token")

    def test_oidc_uses_only_deployer_access_and_exact_backend_id_token_endpoint(self):
        with tempfile.TemporaryDirectory() as directory:
            controller = release.Release(PROJECT, "panthorium-staging", "asia-southeast1", SPEAKER, BACKEND, directory)
            controller.backend_identity = BACKEND_SA
            controller.speaker_url = service(SPEAKER)["status"]["url"]
            response = MagicMock()
            response.__enter__.return_value = response
            response.status = 200
            response.read.return_value = b'{"token":"test.identity.token"}'
            opener = MagicMock()
            opener.open.return_value = response
            with patch.object(controller, "gcloud", return_value="deployer-own-access") as gc, \
                    patch.object(release.urllib.request, "build_opener", return_value=opener) as build:
                self.assertEqual(controller.token(), "test.identity.token")
                gc.assert_called_once_with(["auth", "print-access-token"], json_output=False)
                self.assertIsInstance(build.call_args.args[0], release.NoRedirect)
                request = opener.open.call_args.args[0]
                self.assertEqual(request.full_url, "https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/backend-runtime%40panthorium-production.iam.gserviceaccount.com:generateIdToken")
                self.assertEqual(request.get_header("Authorization"), "Bearer deployer-own-access")
                self.assertEqual(json.loads(request.data), {"audience": controller.speaker_url, "includeEmail": True})
                self.assertEqual(opener.open.call_args.kwargs, {"timeout": 20})
                for body in (b'{}', b'[]', b'{"token":"bad token"}', b'x' * 32769):
                    response.read.return_value = body
                    with self.assertRaises(ValueError):
                        controller.token()
                controller.backend_identity = "attacker@other-project.iam.gserviceaccount.com"
                gc.reset_mock()
                with self.assertRaises(ValueError):
                    controller.token()
                gc.assert_not_called()

    def test_project_url_and_identity_boundaries(self):
        release.production_project(PROJECT, "panthorium-staging")
        for project in ("", "panthorium-staging", "another-staging-project", PROJECT):
            with self.assertRaises(ValueError):
                release.production_project(project, PROJECT if project == PROJECT else "panthorium-staging")
        before = service(BACKEND)
        self.assertEqual(release.backend_identity(before, PROJECT), BACKEND_SA)
        for identity in (SPEAKER_SA.replace(PROJECT, "other-project"), "123-compute@developer.gserviceaccount.com", ""):
            changed = copy.deepcopy(before)
            changed["spec"]["template"]["spec"]["serviceAccountName"] = identity
            with self.assertRaises(ValueError):
                release.backend_identity(changed, PROJECT)
        changed = copy.deepcopy(before)
        changed["spec"]["template"]["spec"]["containers"][0]["env"].append({"name": "BIOMETRIC_SPEAKER_TOKEN", "valueFrom": {"secretKeyRef": {"name": "old-token"}}})
        with self.assertRaises(ValueError):
            release.backend_identity(changed, PROJECT)

    def test_tag_destination_is_exact_and_credentials_are_never_redirected(self):
        canonical = "https://panthorium-speaker-abc.asia-southeast1.run.app"
        tag, revision = "speaker-check-1-1", SPEAKER + "-new-002"
        candidate = {"status": {"traffic": [{"tag": tag, "revisionName": revision,
                                              "url": "https://" + tag + "---" + release.cloud_url(canonical)}]}}
        self.assertIn(tag + "---", release.tagged_url(candidate, tag, revision, canonical))
        for value in ("http://speaker.run.app", "https://speaker.run.app:443", "https://user@speaker.run.app",
                      "https://speaker.run.app/?x=1", "https://speaker.run.app#x", "https://speaker.run.app.evil.test",
                      "https://other---panthorium-speaker-abc.asia-southeast1.run.app"):
            changed = copy.deepcopy(candidate)
            changed["status"]["traffic"][0]["url"] = value
            with self.assertRaises(ValueError):
                release.tagged_url(changed, tag, revision, canonical)
        with self.assertRaises(ValueError):
            release.NoRedirect().redirect_request(None, None, 302, "Found", {}, "https://other.run.app")

    def test_association_preserves_database_network_scaling_and_other_environment(self):
        before = service(BACKEND)
        after = copy.deepcopy(before)
        url = service(SPEAKER)["status"]["url"]
        after["spec"]["template"]["spec"]["containers"][0]["env"].append({"name": "BIOMETRIC_SPEAKER_URL", "value": url})
        release.unchanged_backend(before, after, BACKEND_IMAGE, url)
        for key in ("run.googleapis.com/cloudsql-instances", "run.googleapis.com/vpc-access-egress", "autoscaling.knative.dev/maxScale"):
            changed = copy.deepcopy(after)
            changed["spec"]["template"]["metadata"]["annotations"][key] = "changed"
            with self.assertRaises(ValueError):
                release.unchanged_backend(before, changed, BACKEND_IMAGE, url)
        changed = copy.deepcopy(after)
        changed["spec"]["template"]["spec"]["containers"][0]["env"][2]["value"] = "changed"
        with self.assertRaises(ValueError):
            release.unchanged_backend(before, changed, BACKEND_IMAGE, url)

    def test_rollout_promotes_only_after_full_candidate_checks_without_iam_writes(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(release, "health") as health, patch.object(release, "speaker_inference") as inference:
            controller = FakeRelease(directory)
            output = io.StringIO()
            with redirect_stdout(output):
                receipt = controller.rollout(IMAGE, "123-1")
            self.assertEqual(receipt["status"], "verified")
            self.assertEqual(release.traffic(controller.state[BACKEND]), {BACKEND + "-new-002": 100})
            self.assertEqual(release.traffic(controller.state[SPEAKER]), {SPEAKER + "-new-002": 100})
            self.assertNotIn("preserve-exactly", output.getvalue())
            calls = controller.calls
            self.assertFalse(any("add-iam-policy-binding" in call or "set-iam-policy" in call or "create" in call for call in calls))
            token_calls = [call for call in calls if call[:2] == ["test", "id-token"]]
            self.assertTrue(token_calls)
            for call in token_calls:
                self.assertEqual(call[2:], [BACKEND_SA, controller.speaker_url])
            inference.assert_called_once_with(controller.speaker_url, "test.identity.token")
            health.assert_any_call(controller.speaker_url, "test.identity.token", speaker=True)
            self.assertTrue(any("speaker-check-123-1---" in call.args[0] for call in health.call_args_list))

    def test_ambiguous_backend_promotion_failure_restores_backend_then_speaker(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(release, "health"), patch.object(release, "speaker_inference"):
            controller = FakeRelease(directory)
            controller.fail_backend_promotion = True
            with self.assertRaisesRegex(ValueError, "previous production traffic"):
                controller.rollout(IMAGE, "123-1")
            for name in (BACKEND, SPEAKER):
                self.assertEqual(release.traffic(controller.state[name]), {name + "-old-001": 100})
                self.assertFalse(any(item.get("tag", "").endswith("123-1") for item in controller.state[name]["status"]["traffic"]))
            restorations = [call[3] for call in controller.calls if call[:3] == ["run", "services", "update-traffic"]
                            and any(arg.endswith("old-001=100") for arg in call)]
            self.assertEqual(restorations, [BACKEND, SPEAKER])

    def test_failed_backend_rollback_keeps_verified_speaker_and_requires_review(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(release, "health"), patch.object(release, "speaker_inference"):
            controller = FakeRelease(directory)
            controller.fail_backend_promotion = controller.fail_backend_rollback = True
            with self.assertRaisesRegex(ValueError, "operator review"):
                controller.rollout(IMAGE, "123-1")
            self.assertEqual(release.traffic(controller.state[SPEAKER]), {SPEAKER + "-new-002": 100})
            self.assertFalse(any(call[:4] == ["run", "services", "update-traffic", SPEAKER]
                                 and any(arg.endswith("old-001=100") for arg in call) for call in controller.calls))

    def test_failed_candidate_health_never_changes_live_traffic(self):
        def health(url, *args, **kwargs):
            if "speaker-check-" in url:
                raise ValueError("Synthetic unhealthy candidate")
        with tempfile.TemporaryDirectory() as directory, patch.object(release, "health", side_effect=health), patch.object(release, "speaker_inference"):
            controller = FakeRelease(directory)
            with self.assertRaisesRegex(ValueError, "previous production traffic"):
                controller.rollout(IMAGE, "123-1")
            for name in (BACKEND, SPEAKER):
                self.assertEqual(release.traffic(controller.state[name]), {name + "-old-001": 100})
            self.assertFalse(any(any(arg.startswith("--to-revisions=") for arg in call) for call in controller.calls))

    def test_rollback_refuses_concurrent_revision_or_traffic_changes(self):
        current = service(BACKEND)
        old, candidate = BACKEND + "-old-001", BACKEND + "-new-002"
        current["status"].update(latestCreatedRevisionName=candidate, latestReadyRevisionName=candidate)
        self.assertFalse(release.rollback_allowed(current, candidate, old))
        current["status"]["traffic"] = [{"revisionName": candidate, "percent": 100}]
        self.assertTrue(release.rollback_allowed(current, candidate, old))
        changed = copy.deepcopy(current)
        changed["status"]["latestCreatedRevisionName"] = BACKEND + "-operator-003"
        with self.assertRaises(ValueError):
            release.rollback_allowed(changed, candidate, old)
        current["status"]["traffic"] = [{"revisionName": old, "percent": 50}, {"revisionName": candidate, "percent": 50}]
        with self.assertRaises(ValueError):
            release.rollback_allowed(current, candidate, old)

    def test_workflow_is_reusable_main_only_and_preserves_exact_image_gate(self):
        text = (ROOT / ".github/workflows/deploy-speaker-production.yml").read_text()
        self.assertIn("workflow_call:", text)
        self.assertNotIn("workflow_dispatch:", text)
        self.assertNotIn("concurrency:", text)
        self.assertEqual(text.count("if: github.ref == 'refs/heads/main'"), 2)
        self.assertIn("needs: security", text)
        self.assertIn("profile: speaker", text)
        self.assertIn("require-model: 'true'", text)
        self.assertIn("image: ${{ steps.built-image.outputs.image }}", text)
        self.assertNotIn("continue-on-error", text)


if __name__ == "__main__":
    unittest.main()
