# Notebook deployment

The live application is served from this Windows notebook. GitHub-hosted CI tests
pushes to main and staging. Only a successful push run of Panthorium CI can
advance deploy/notebook-production or deploy/notebook-staging. The publisher
uses no checkout, PR artifacts, or notebook credentials. Cloud deployment
workflows remain disabled.

A local task checks these public Git refs every minute while the Asus Windows
session is signed in. The current source branch and tested deployment ref must
identify the same exact commit. Production and staging have independent immutable
release directories, process identities, ports, databases, uploads and journals.

Deployment builds production dependencies without install scripts, takes an
online backup, restores a private test database, and tests login, uploads,
downloads and ownership with outbound workers disabled. Only after this succeeds
does it enable maintenance, drain the previous process and take the final
database/upload snapshot. The new app is checked on its private port before
the proxy route changes. On failure before exposure, restore the snapshot and
restart the previous version. After exposure, never automatically restore data:
users may already have written to the new version.

## Host paths

- Application releases: D:\Panthorium\Deploy\releases
- Controller (installed separately, not self-updated): D:\Panthorium\Host\deploy
- Actual activation status: D:\Panthorium\Deploy\status.json
- Per-environment routes and journals: D:\Panthorium\Host\production and staging
- Deployment backups and receipts: D:\Panthorium\Deploy\operations
- Main PostgreSQL data: D:\Panthorium\Database
- User uploads: D:\Panthorium\Uploads
- Task: Panthorium Automatic Deploy

Keep the last three successful deployment operations and their current/previous
code versions. Failed operations and failed databases are preserved for review.
Deployment pauses when fewer than 8 GiB are free. These are local backups;
they do not protect against loss of the notebook or its D drive.

## Runtime boundaries

This pipeline updates the web application, Node API and their locked production
dependencies. PostgreSQL itself, Qwen model files, the verified speaker/media
containers, and the deployment controller are managed separately. A fingerprint
blocks automatic app deployment when those tracked host-runtime sources change;
install and verify the corresponding host runtime explicitly first.

Secrets stay in the existing user-bound DPAPI files. The agent uses public
read-only Git operations and has no GitHub token. The edge and backend listen
only on 127.0.0.1; the existing Cloudflare Tunnel routes into the edge.
The shutdown endpoint is token-protected and never forwarded by the edge.

If Windows is off or the user has not signed in, deployment waits. When the
notebook is online again it checks the latest tested branch heads. GitHub's
publisher success means a version is eligible; the local status/operation
receipt confirms whether it was actually activated.

The controller's explicit deploy command is an operator-only recovery/bootstrap
path. Scheduled operation only invokes agent.py once and enforces the CI refs.
