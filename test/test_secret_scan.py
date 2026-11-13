import hashlib
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('scan_secrets', Path(__file__).resolve().parents[1]/'scripts/scan-secrets.py')
scan = importlib.util.module_from_spec(spec); spec.loader.exec_module(scan)

class SecretScanTests(unittest.TestCase):
    def test_sensitive_filenames_and_example_exception(self):
        for name in ['.env', '.env.local', 'nested/.env.production', '.claude/settings.local.json',
                     'x/.claude/settings.local.json', '.codex/auth.json', 'local-profile.json',
                     'x/LOCAL_LOGIN.txt', 'x/key.dpapi', 'signing.p12', 'x/id_ed25519',
                     'panthorium-state/state.json', 'x/trial-api-key.txt']:
            self.assertTrue(scan.blocked_path(name), name)
        for name in ['.env.example', 'nested/.env.example', '.claude/settings.json', 'scripts/local-profile.cjs',
                     'scripts/local-secret-store.cjs', 'mobile/android/firebase/google-services.json']:
            self.assertFalse(scan.blocked_path(name), name)

    def test_exception_requires_exact_value_path_and_rule(self):
        finding={'Secret':'synthetic-value', 'File':'known-file', 'RuleID':'known-rule'}
        exceptions=[{'path':'known-file', 'rule':'known-rule', 'sha256':hashlib.sha256(b'synthetic-value').hexdigest()}]
        self.assertTrue(scan.approved(finding,exceptions))
        for key in ['Secret','File','RuleID']:
            self.assertFalse(scan.approved({**finding,key:'changed'},exceptions))

    def test_output_never_includes_match_secret_or_author(self):
        finding={'Secret':'sensitive-value', 'Match':'sensitive-line', 'Author':'private-author',
                 'File':'file.js', 'RuleID':'rule', 'StartLine':1, 'Commit':'abc'}
        result=scan.safe_finding(finding)
        self.assertEqual(set(result),{'File','RuleID','StartLine','Commit'})
        self.assertNotIn('sensitive',str(result))

if __name__=='__main__': unittest.main()
