import copy
from contextlib import redirect_stdout
import importlib.util
import io
import json
from pathlib import Path
import subprocess
from types import SimpleNamespace
import unittest
from unittest.mock import patch


spec = importlib.util.spec_from_file_location("cloud_readiness", Path(__file__).resolve().parents[1] / "scripts/check-cloud-readiness.py")
cloud = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cloud)
PROJECT = "panthorium-staging"
BACKEND = "panthorium-backend-staging"
SPEAKER = "panthorium-speaker-staging"
BACKEND_ACCOUNT = f"backend-runtime@{PROJECT}.iam.gserviceaccount.com"
SPEAKER_ACCOUNT = f"speaker-runtime@{PROJECT}.iam.gserviceaccount.com"


def service(name, account, names=()):
    revision = name + "-00012-abc"
    return {
        "metadata": {"name": name, "annotations": {cloud.INVOKER_ANNOTATION: "false"}},
        "spec": {"template": {"spec": {"serviceAccountName": account, "containers": [
            {"env": [{"name": value} for value in names]}
        ]}}},
        "status": {"latestReadyRevisionName": revision, "latestCreatedRevisionName": revision,
                   "traffic": [{"revisionName": revision, "percent": 100}]},
    }


def fixtures():
    return {
        "backend_service": service(BACKEND, BACKEND_ACCOUNT, cloud.REQUIRED_BACKEND_ENV),
        "speaker_service": service(SPEAKER, SPEAKER_ACCOUNT),
        "speaker_account": {"email": SPEAKER_ACCOUNT, "disabled": False},
        "project_policy": {"etag": "test-project", "bindings": []},
        "speaker_policy": {"etag": "test-service", "bindings": [
            {"role": "roles/run.invoker", "members": ["serviceAccount:" + BACKEND_ACCOUNT]}
        ]},
    }


class CloudReadinessTests(unittest.TestCase):
    def reader(self, responses=None, failures=None):
        responses = fixtures() if responses is None else responses
        failures = {} if failures is None else failures
        calls = []
        reader = cloud.CloudReader(PROJECT, "asia-southeast1", BACKEND, SPEAKER)

        def run(command, **options):
            calls.append((command, options))
            key = next(name for name, allowed in reader.commands.items() if command == allowed)
            if key in failures:
                failure = failures[key]
                if isinstance(failure, Exception):
                    raise failure
                return SimpleNamespace(returncode=1, stdout="", stderr=failure)
            return SimpleNamespace(returncode=0, stdout=json.dumps(responses[key]), stderr="")

        reader.runner = run
        return reader, calls

    def test_valid_projected_snapshot_passes_only_its_declared_scope(self):
        reader, calls = self.reader()
        report = cloud.check_readiness(reader)
        self.assertEqual(report["scopeStatus"], "verified_within_scope")
        self.assertTrue(report["checksPassed"])
        self.assertTrue(all(value == "verified" for value in report["checks"].values()))
        self.assertFalse(report["releaseApproved"])
        self.assertIn("Inherited organization/folder IAM and permissions on other resources", report["notVerified"])
        self.assertEqual(len(calls), 5)
        serialized = json.dumps(report)
        self.assertNotIn(SPEAKER_ACCOUNT, serialized)
        self.assertNotIn(BACKEND_ACCOUNT, serialized)
        self.assertNotIn("roles/run.invoker", serialized)
        for command, options in calls:
            self.assertFalse(options["shell"])
            self.assertEqual(options["stdin"], subprocess.DEVNULL)
            self.assertEqual(options["timeout"], 30)
            self.assertEqual(options["env"]["CLOUDSDK_CORE_LOG_HTTP"], "false")
            self.assertEqual(options["env"]["CLOUDSDK_CORE_DISABLE_FILE_LOGGING"], "1")
            if command[1:4] == ("run", "services", "describe"):
                projection = command[-1]
                self.assertIn("env[].name", projection)
                self.assertNotIn("env[].value", projection)
                self.assertNotIn("json(metadata.annotations,", projection)

    def test_mutations_secret_access_and_extra_flags_cannot_reach_runner(self):
        reader, calls = self.reader()
        original = reader.commands["speaker_service"]
        commands = [
            ("gcloud", "run", "deploy", SPEAKER),
            ("gcloud", "secrets", "versions", "access", "latest"),
            ("gcloud", "projects", "add-iam-policy-binding", PROJECT),
            original + ("--log-http",),
            original[:-1] + ("--format=json",),
        ]
        for command in commands:
            with self.subTest(command=command):
                with self.assertRaisesRegex(ValueError, "allowlist"):
                    reader.execute(command)
        self.assertEqual(calls, [])
        with self.assertRaisesRegex(ValueError, "Unknown"):
            reader.read("deploy")
        with self.assertRaises(TypeError):
            reader.commands["speaker_service"] = commands[0]
        for project in ("--impersonate-service-account=x", "project;echo bad", "project name"):
            with self.assertRaises(ValueError):
                cloud.CloudReader(project, "asia-southeast1", BACKEND, SPEAKER)

    def test_missing_denied_and_unavailable_are_unverified_not_safe(self):
        cases = [
            ("PERMISSION_DENIED: private-policy-canary", "permission_denied"),
            ("NOT_FOUND: private-policy-canary", "not_found_or_not_visible"),
            ("UNAUTHENTICATED private-policy-canary", "authentication_required"),
            (FileNotFoundError("private-policy-canary"), "gcloud_unavailable"),
            (subprocess.TimeoutExpired("private-policy-canary", 30), "timeout"),
        ]
        for error, expected in cases:
            with self.subTest(expected=expected):
                reader, _ = self.reader(failures={"project_policy": error})
                report = cloud.check_readiness(reader)
                self.assertEqual(report["reads"]["project_policy"], expected)
                self.assertEqual(report["checks"]["speaker_has_no_project_role_bindings"], "unverified")
                self.assertEqual(report["scopeStatus"], "blocked_or_unverified")
                self.assertFalse(report["checksPassed"])
                self.assertNotIn("private-policy-canary", json.dumps(report))

    def test_missing_account_is_not_confused_with_verified_disabled_account(self):
        reader, _ = self.reader(failures={"speaker_account": "NOT_FOUND"})
        report = cloud.check_readiness(reader)
        self.assertEqual(report["checks"]["speaker_account_exists_and_enabled"], "unverified")
        data = fixtures()
        data["speaker_account"]["disabled"] = True
        reader, _ = self.reader(data)
        self.assertEqual(cloud.check_readiness(reader)["checks"]["speaker_account_exists_and_enabled"], "blocked")

    def test_public_shared_privileged_and_bypassed_states_block(self):
        cases = []
        data = fixtures()
        data["backend_service"]["spec"]["template"]["spec"]["serviceAccountName"] = SPEAKER_ACCOUNT
        cases.append((data, "backend_identity_is_separate"))
        data = fixtures()
        data["speaker_service"]["spec"]["template"]["spec"]["serviceAccountName"] = BACKEND_ACCOUNT
        cases.append((data, "speaker_uses_dedicated_identity"))
        data = fixtures()
        data["speaker_service"]["metadata"]["annotations"][cloud.INVOKER_ANNOTATION] = "true"
        cases.append((data, "speaker_invoker_iam_check_enabled"))
        data = fixtures()
        data["project_policy"]["bindings"] = [{"role": "roles/viewer", "members": ["serviceAccount:" + SPEAKER_ACCOUNT]}]
        cases.append((data, "speaker_has_no_project_role_bindings"))
        for policy in ("project_policy", "speaker_policy"):
            data = fixtures()
            data[policy]["bindings"].append({"role": "roles/viewer", "members": ["allUsers"]})
            cases.append((data, policy + "_has_no_public_bindings"))
        data = fixtures()
        data["speaker_policy"]["bindings"][0]["members"].append("allAuthenticatedUsers")
        cases.append((data, "speaker_invoker_binding_is_backend_only"))
        data = fixtures()
        data["speaker_policy"]["bindings"][0]["condition"] = {"expression": "false"}
        cases.append((data, "speaker_invoker_binding_is_backend_only"))
        for data, check in cases:
            with self.subTest(check=check):
                reader, _ = self.reader(data)
                report = cloud.check_readiness(reader)
                self.assertEqual(report["checks"][check], "blocked")
                self.assertEqual(report["scopeStatus"], "blocked_or_unverified")

    def test_wrong_active_revision_and_missing_env_name_block(self):
        for service_name in ("backend_service", "speaker_service"):
            data = fixtures()
            data[service_name]["status"]["traffic"][0]["revisionName"] = "old-revision"
            reader, _ = self.reader(data)
            report = cloud.check_readiness(reader)
            self.assertEqual(report["checks"][service_name + "_serves_current_ready_revision"], "blocked")
        data = fixtures()
        data["backend_service"]["spec"]["template"]["spec"]["containers"][0]["env"].pop()
        reader, _ = self.reader(data)
        self.assertEqual(cloud.check_readiness(reader)["checks"]["backend_env_BIOMETRIC_TEMPLATE_KEY_present"], "blocked")

    def test_malformed_or_unprojected_data_never_proves_safety_or_leaks(self):
        cases = [("project_policy", {}), ("speaker_policy", {"etag": "x", "bindings": "canary-raw-policy"})]
        data = fixtures()["backend_service"]
        data["spec"]["template"]["spec"]["containers"][0]["env"][0]["value"] = "canary-secret-value"
        cases.append(("backend_service", data))
        for name, replacement in cases:
            with self.subTest(name=name):
                responses = fixtures()
                responses[name] = copy.deepcopy(replacement)
                reader, _ = self.reader(responses)
                report = cloud.check_readiness(reader)
                self.assertEqual(report["reads"][name], "invalid_response")
                self.assertEqual(report["scopeStatus"], "blocked_or_unverified")
                self.assertNotIn("canary-", json.dumps(report))

    def test_cli_exit_code_and_json_keep_failed_reads_closed(self):
        for failures, expected in [({}, 0), ({"speaker_policy": "PERMISSION_DENIED canary-private"}, 1)]:
            with self.subTest(expected=expected):
                reader, _ = self.reader(failures=failures)
                output = io.StringIO()
                with patch.object(cloud, "CloudReader", return_value=reader), redirect_stdout(output):
                    code = cloud.main(["--project", PROJECT, "--region", "asia-southeast1",
                                       "--backend-service", BACKEND, "--speaker-service", SPEAKER])
                report = json.loads(output.getvalue())
                self.assertEqual(code, expected)
                self.assertEqual(report["checksPassed"], expected == 0)
                self.assertFalse(report["releaseApproved"])
                self.assertNotIn("canary-private", output.getvalue())


if __name__ == "__main__":
    unittest.main()
