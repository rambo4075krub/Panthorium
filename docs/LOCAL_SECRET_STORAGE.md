# Local credentials and repository secret protection

The Windows local pilot stores its generated administrator password and JWT
signing secret in `../panthorium-state/local-profile.dpapi`. Windows DPAPI
CurrentUser encrypts the payload. The directory and credential files permit
only the current account, SYSTEM and local Administrators. Secrets are passed
to the fixed PowerShell helper through stdin; they are never command arguments.
Production and staging runtime credentials continue using their existing
protected deployment configuration.

## Existing local profiles

Normal local-pilot startup migrates `local-profile.json` automatically. To migrate
an existing profile without starting the application, run from the checkout:

```powershell
node scripts/local-credentials.cjs migrate
```

Migration preserves the username, password and JWT secret. It restricts access,
encrypts to a temporary file, flushes the file, verifies decryption and publishes
the encrypted profile before removing `LOCAL_LOGIN.txt` and `local-profile.json`.
It does not print credentials. An encryption failure preserves the plaintext
original for recovery under restricted permissions. A corrupt encrypted profile
or conflict between encrypted and legacy files fails closed rather than silently
generating a different account or using plaintext.

If a process is forcibly stopped during migration, a `local-profile.lock` may
remain. Confirm that no local-profile operation is running before removing that
lock and retrying. Keep any existing `.dpapi` file: do not delete it to bypass a
decryption error. A different Windows account or machine ordinarily cannot read
the profile; migration to another computer needs a deliberate secure transfer.

When the local login password is needed, the same Windows user can run:

```powershell
node scripts/local-credentials.cjs show
```

This explicit operation requires an interactive input/output terminal and prints
only the local login, never the JWT secret. Do not record, share or redirect that
terminal. Normal startup never writes or prints the password. The local smoke
test decrypts the profile directly in memory. Platforms without Windows DPAPI
fail closed for this Windows-only local-pilot helper; this does not change the
cross-platform app or production startup path.

DPAPI protects copied files; it does not make secrets inaccessible to malware
running as the same user or an administrator controlling the machine. Restrict
software execution and enable supported disk encryption as an additional layer.
Before enabling disk encryption, ensure administrator access and a verified
recovery-key backup independent of the encrypted disk. Deleting plaintext does
not erase old backups, synchronized copies or every recoverable disk block.
If exposure is confirmed, rotate the affected credentials and invalidate
sessions in the affected environment; do not rotate production keys merely
because an unrelated local-pilot file existed.

## Commit and build protection

`.gitignore` and `.dockerignore` exclude local agent permissions, environment
files, local credentials, private keys and keystores. `.env.example` remains
available. Shared `.claude/settings.json` is allowed, but its contents are scanned.
Ignore rules cannot untrack an already committed file.

The `Secret protection` workflow checks tracked files and reachable Git history
on pull requests and on main/staging pushes. Gitleaks is pinned to 8.30.1 and its
Linux download must match a fixed SHA-256 checksum. The scan fails if the binary
cannot run or if its synthetic provider-key/agent-password detection checks fail.
The scanner's raw findings remain in process memory: logs contain only paths,
line numbers, rule identifiers and commits. It does not upload raw reports.

The two reviewed exceptions in `scripts/secret-scan-allowlist.json` require an
exact file path, detector and SHA-256 of the detected value. They cover the
existing Firebase Android client key and one synthetic redaction-test token.
A new value at the same location is not exempt. Keep the Firebase key restricted
to its intended app/APIs; the scan does not verify Google Cloud restrictions.
Do not exempt an entire test directory, agent folder or provider-key family.

```sh
python3 scripts/scan-secrets.py --gitleaks /path/to/gitleaks --history
```

GitHub Secret Protection and branch required-check settings are separate from
this workflow. Add its checks to branch rules when the repository's available
settings and permissions allow it. Repository scanning does not cover unpushed
files, release binaries, backups or credentials stored on the actual host.
