"""Validate the configured upload key without logging credentials or changing it."""
import base64
import hashlib
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import zipfile


class SigningError(Exception):
    pass


def run_private(command, env, failure):
    # Tool errors can contain aliases and paths. Return only our fixed diagnostic.
    try:
        result = subprocess.run(command, env=env, stdin=subprocess.DEVNULL,
                                capture_output=True, timeout=30)
    except (OSError, subprocess.TimeoutExpired):
        raise SigningError(failure) from None
    if result.returncode:
        raise SigningError(failure)
    return result.stdout


def check_upload_key(env=None):
    env = dict(os.environ if env is None else env)
    required = ('PANTHORIUM_UPLOAD_KEYSTORE_PATH', 'PANTHORIUM_UPLOAD_STORE_PASSWORD',
                'PANTHORIUM_UPLOAD_KEY_ALIAS', 'PANTHORIUM_UPLOAD_KEY_PASSWORD')
    missing = [name for name in required if not env.get(name)]
    if missing:
        raise SigningError('Missing signing configuration: ' + ', '.join(missing))
    for tool in ('keytool', 'jarsigner'):
        if not shutil.which(tool, path=env.get('PATH')):
            raise SigningError('Missing JDK tool: ' + tool + '; install the full JDK')
    store = Path(env[required[0]])
    if not store.is_absolute() or not store.is_file():
        raise SigningError('Upload keystore must be an existing absolute file path')
    alias = env['PANTHORIUM_UPLOAD_KEY_ALIAS']
    if alias.lower() == 'androiddebugkey':
        raise SigningError('The Android debug key cannot be used for this release')
    common = ['-keystore', str(store), '-storepass:env', 'PANTHORIUM_UPLOAD_STORE_PASSWORD']
    certificate = run_private(
        ['keytool', '-exportcert', *common, '-alias', alias], env,
        'Cannot read upload certificate; check the keystore, store password and alias')
    if not certificate:
        raise SigningError('Upload certificate is empty')
    # Listing a certificate alone does not prove that the entry has a usable
    # private key or that its separate key password is correct.
    with tempfile.TemporaryDirectory(prefix='panthorium-signing-check-') as directory:
        probe = Path(directory) / 'probe.jar'
        with zipfile.ZipFile(probe, 'w') as archive:
            archive.writestr('probe.txt', 'Panthorium upload-key readiness check\n')
        run_private(['jarsigner', *common, '-keypass:env', 'PANTHORIUM_UPLOAD_KEY_PASSWORD',
                     str(probe), alias], env,
                    'Cannot sign with this entry; check private-key availability and key password')
        verified = run_private(['jarsigner', '-J-Duser.language=en', '-J-Duser.country=US',
                                '-verify', str(probe)], env,
                               'Upload-key signing probe failed verification')
        if b'jar verified.' not in verified:
            raise SigningError('Upload-key signing probe was not verified')
    return hashlib.sha256(certificate).hexdigest()


def signed_certificate_sha256(archive, env=None):
    """Read the public signer certificate; signature verification is separate."""
    output = run_private(['keytool', '-printcert', '-rfc', '-jarfile', str(archive)],
                         dict(os.environ if env is None else env),
                         'Cannot read the signed archive certificate')
    match = re.search(rb'-----BEGIN CERTIFICATE-----\s*(.*?)\s*-----END CERTIFICATE-----',
                      output, re.DOTALL)
    if not match:
        raise SigningError('No signer certificate found in archive')
    certificate = base64.b64decode(re.sub(rb'\s+', b'', match[1]), validate=True)
    return hashlib.sha256(certificate).hexdigest()


if __name__ == '__main__':
    try:
        fingerprint = check_upload_key()
    except SigningError as error:
        raise SystemExit(str(error)) from None
    print('Upload key can sign. Certificate SHA-256: ' + fingerprint)
    print('This checks signing credentials, not AAB compilation or Play approval.')
