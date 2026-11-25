#!/bin/sh
set -eu
# Locally built APKs retain real package versions, dependencies and full scanner inventory.
# The private signing key remains in this disposable build stage.
abuild-keygen -a -n
cp /root/.abuild/*.rsa.pub /etc/apk/keys/
for name in glib expat openssl; do
    (cd "/build/alpine-security/$name" && abuild -F)
done
mkdir -p /out/packages /out/keys
find /root/packages -type f \( -name 'glib-2.90.1-r0.apk' -o -name 'libexpat-2.10.0-r0.apk' -o -name 'libcrypto3-3.5.9-r2.apk' -o -name 'libssl3-3.5.9-r2.apk' -o -name 'openssl-3.5.9-r2.apk' \) -exec cp {} /out/packages/ \;
cp /root/.abuild/*.rsa.pub /out/keys/
test -s /out/packages/glib-2.90.1-r0.apk
test -s /out/packages/libexpat-2.10.0-r0.apk
test -s /out/packages/libcrypto3-3.5.9-r2.apk
test -s /out/packages/libssl3-3.5.9-r2.apk
# Inspect the signed, stripped APK payload that will actually be installed.
apk add --no-cache /out/packages/libcrypto3-3.5.9-r2.apk /out/packages/libssl3-3.5.9-r2.apk /out/packages/openssl-3.5.9-r2.apk
mkdir -p /out/share/panthorium
node /build/alpine-security/openssl/record-build.mjs
# The application needs the libraries, not the OpenSSL administration CLI.
rm /out/packages/openssl-3.5.9-r2.apk
