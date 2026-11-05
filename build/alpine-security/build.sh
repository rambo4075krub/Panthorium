#!/bin/sh
set -eu
# Locally built APKs retain real package versions, dependencies and full scanner inventory.
# The private signing key remains in this disposable build stage.
abuild-keygen -a -n
cp /root/.abuild/*.rsa.pub /etc/apk/keys/
for name in glib expat; do
    (cd "/build/alpine-security/$name" && abuild -F)
done
mkdir -p /out/packages /out/keys
find /root/packages -type f \( -name 'glib-2.90.1-r0.apk' -o -name 'libexpat-2.10.0-r0.apk' \) -exec cp {} /out/packages/ \;
cp /root/.abuild/*.rsa.pub /out/keys/
test -s /out/packages/glib-2.90.1-r0.apk
test -s /out/packages/libexpat-2.10.0-r0.apk
