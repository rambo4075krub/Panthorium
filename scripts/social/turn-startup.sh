#!/bin/bash
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
if test -f /etc/panthorium-turn-ready; then exit 0; fi
systemctl mask coturn
apt-get update -qq
apt-get install -y -qq coturn
# This VM has no service account, OAuth scopes, cloud credentials, or secret in metadata.
# The authenticated operator installs the restricted config through IAP SSH.
systemctl disable --now coturn
