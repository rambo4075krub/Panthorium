import copy
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("verify_speaker_deployment", Path(__file__).resolve().parents[1] / "scripts/verify-speaker-deployment.py")
policy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(policy)


class DeploymentSecurityTests(unittest.TestCase):
    def test_only_the_exact_ready_candidate_can_receive_traffic(self):
        service = "panthorium-speaker-staging"
        revision = f"{service}-00017-abc"
        candidate = {"status": {"latestReadyRevisionName": revision, "latestCreatedRevisionName": revision}}
        self.assertEqual(policy.verify_candidate(service, candidate, candidate), revision)
        for key in ["latestReadyRevisionName", "latestCreatedRevisionName"]:
            changed = copy.deepcopy(candidate)
            changed["status"][key] = f"{service}-00018-def"
            with self.assertRaises(ValueError):
                policy.verify_candidate(service, candidate, changed)
        with self.assertRaises(ValueError):
            policy.verify_candidate(service, {}, candidate)
        with self.assertRaises(ValueError):
            policy.verify_candidate("another-service", candidate, candidate)

    def test_shared_privileged_disabled_and_public_identities_fail_closed(self):
        project = "panthorium-staging"
        speaker = f"speaker-runtime@{project}.iam.gserviceaccount.com"
        backend = f"backend-runtime@{project}.iam.gserviceaccount.com"
        policy.verify_identity(project, speaker, backend, {"email": speaker}, {"bindings": []})
        for changed in [
            (backend, backend, {"email": backend}, {}),
            (speaker, backend, {"email": speaker, "disabled": True}, {}),
            (speaker, backend, {"email": speaker}, {"bindings": [{"role": "roles/editor", "members": [f"serviceAccount:{speaker}"]}]}),
            (speaker, backend, {"email": speaker}, {"bindings": [{"role": "roles/run.invoker", "members": ["allAuthenticatedUsers"]}]}),
        ]:
            with self.assertRaises(ValueError):
                policy.verify_identity(project, *changed)

    def test_invoker_bypass_and_unexpected_callers_are_rejected(self):
        speaker, backend = "speaker-runtime@test.iam.gserviceaccount.com", "backend@test.iam.gserviceaccount.com"
        service = {"metadata": {"annotations": {}}, "spec": {"template": {"spec": {"serviceAccountName": speaker}}}}
        binding = {"bindings": [{"role": "roles/run.invoker", "members": [f"serviceAccount:{backend}"]}]}
        policy.verify_service(speaker, backend, service, binding)
        for member in ["allUsers", "allAuthenticatedUsers", "serviceAccount:other@test.iam.gserviceaccount.com"]:
            changed = copy.deepcopy(binding)
            changed["bindings"][0]["members"].append(member)
            with self.assertRaises(ValueError):
                policy.verify_service(speaker, backend, service, changed)
        changed = copy.deepcopy(service)
        changed["metadata"]["annotations"]["run.googleapis.com/invoker-iam-disabled"] = "true"
        with self.assertRaises(ValueError):
            policy.verify_service(speaker, backend, changed, binding)


if __name__ == "__main__":
    unittest.main()
