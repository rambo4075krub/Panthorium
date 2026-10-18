"""Real JDK signing tests using disposable test keys, never production keys."""
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import zipfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from signing_preflight import SigningError, check_upload_key, signed_certificate_sha256


class SigningPreflightTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.directory = tempfile.TemporaryDirectory(prefix='panthorium-test-signing-')
        cls.store = Path(cls.directory.name) / 'test-only.jks'
        cls.env = {**os.environ, 'PANTHORIUM_UPLOAD_KEYSTORE_PATH': str(cls.store),
                   'PANTHORIUM_UPLOAD_STORE_PASSWORD': 'test-store-password-only',
                   'PANTHORIUM_UPLOAD_KEY_PASSWORD': 'test-key-password-only',
                   'PANTHORIUM_UPLOAD_KEY_ALIAS': 'disposable-test-key'}
        # JKS allows separate passwords, exercising a failure that listing a
        # certificate alone would miss. This fixture is removed after the test.
        subprocess.run(['keytool', '-genkeypair', '-storetype', 'JKS', '-keystore', str(cls.store),
                        '-storepass:env', 'PANTHORIUM_UPLOAD_STORE_PASSWORD',
                        '-keypass:env', 'PANTHORIUM_UPLOAD_KEY_PASSWORD',
                        '-alias', cls.env['PANTHORIUM_UPLOAD_KEY_ALIAS'],
                        '-keyalg', 'RSA', '-keysize', '2048', '-validity', '30',
                        '-dname', 'CN=DISPOSABLE TEST ONLY'], env=cls.env,
                       capture_output=True, check=True, timeout=30)

    @classmethod
    def tearDownClass(cls):
        cls.directory.cleanup()

    def test_key_can_sign_and_matches_archive_certificate(self):
        fingerprint = check_upload_key(self.env)
        self.assertRegex(fingerprint, r'^[a-f0-9]{64}$')
        archive = Path(self.directory.name) / 'signed-test-fixture.jar'
        with zipfile.ZipFile(archive, 'w') as output:
            output.writestr('test.txt', 'Not an Android release')
        subprocess.run(['jarsigner', '-keystore', str(self.store),
                        '-storepass:env', 'PANTHORIUM_UPLOAD_STORE_PASSWORD',
                        '-keypass:env', 'PANTHORIUM_UPLOAD_KEY_PASSWORD',
                        str(archive), self.env['PANTHORIUM_UPLOAD_KEY_ALIAS']],
                       env=self.env, capture_output=True, check=True, timeout=30)
        self.assertEqual(signed_certificate_sha256(archive), fingerprint)

    def test_missing_settings_list_names_only(self):
        with self.assertRaisesRegex(SigningError, 'Missing signing configuration') as caught:
            check_upload_key({})
        self.assertIn('PANTHORIUM_UPLOAD_KEY_PASSWORD', str(caught.exception))

    def test_bad_store_password_and_alias(self):
        for name in ('PANTHORIUM_UPLOAD_STORE_PASSWORD', 'PANTHORIUM_UPLOAD_KEY_ALIAS'):
            with self.subTest(name=name):
                with self.assertRaisesRegex(SigningError, 'Cannot read upload certificate') as caught:
                    check_upload_key({**self.env, name: 'secret-invalid-value'})
                self.assertNotIn('secret-invalid-value', str(caught.exception))

    def test_bad_private_key_password(self):
        with self.assertRaisesRegex(SigningError, 'Cannot sign with this entry'):
            check_upload_key({**self.env, 'PANTHORIUM_UPLOAD_KEY_PASSWORD': 'wrong-key-password'})

    def test_debug_key_and_relative_path_rejected(self):
        with self.assertRaisesRegex(SigningError, 'debug key'):
            check_upload_key({**self.env, 'PANTHORIUM_UPLOAD_KEY_ALIAS': 'androiddebugkey'})
        with self.assertRaisesRegex(SigningError, 'absolute file path'):
            check_upload_key({**self.env, 'PANTHORIUM_UPLOAD_KEYSTORE_PATH': 'test-only.jks'})

    def test_unsigned_archive_has_no_signer_certificate(self):
        archive = Path(self.directory.name) / 'unsigned-test-fixture.jar'
        with zipfile.ZipFile(archive, 'w') as output:
            output.writestr('test.txt', 'Unsigned')
        with self.assertRaises(SigningError):
            signed_certificate_sha256(archive)


if __name__ == '__main__':
    unittest.main()
