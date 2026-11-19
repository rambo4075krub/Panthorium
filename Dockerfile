FROM node:24.22.3-alpine AS native-security-build
RUN apk add --no-cache alpine-sdk meson python3-dev py3-packaging libffi-dev pcre2-dev 'zlib-dev>=1.4-r0' gettext-dev bash perl linux-headers
# Only compilation inputs invalidate the native build cache. Review policies
# remain in the complete application checkout and are enforced after the build.
COPY build/alpine-security/build.sh /build/alpine-security/
COPY build/alpine-security/glib/ /build/alpine-security/glib/
COPY build/alpine-security/expat/ /build/alpine-security/expat/
COPY build/alpine-security/openssl/APKBUILD build/alpine-security/openssl/*.patch \
    build/alpine-security/openssl/openssl-fips.post-install build/alpine-security/openssl/apply-patches.py \
    build/alpine-security/openssl/record-build.mjs build/alpine-security/openssl/openssl-source.lock.json \
    build/alpine-security/openssl/test-security.c /build/alpine-security/openssl/
RUN sh /build/alpine-security/build.sh

FROM node:24.22.3-alpine AS media-build
RUN apk add --no-cache build-base pkgconf nasm patch x264-dev opus-dev libass-dev 'zlib-dev>=1.4-r0'
COPY build/media/*.lock.json build/media/build-ffmpeg.mjs build/media/test-encoder-geometry.c /build/media/
COPY build/media/patches/ /build/media/patches/
RUN node /build/media/build-ffmpeg.mjs

FROM node:24.22.3-alpine AS runtime
# Only the libraries used by the reviewed CPU/local-file build, plus captions.
COPY --from=native-security-build /out/keys/ /etc/apk/keys/
COPY --from=native-security-build /out/packages/ /tmp/panthorium-security-packages/
RUN apk add --no-cache /tmp/panthorium-security-packages/*.apk x264-libs opus libass 'zlib>=1.4-r0' font-dejavu font-noto-thai \
    && rm -rf /tmp/panthorium-security-packages
COPY build/alpine-security/sources.json /usr/local/share/panthorium/native-security-sources.json
COPY --from=native-security-build /out/share/panthorium/ /usr/local/share/panthorium/
COPY --from=media-build /opt/ffmpeg/bin/ffmpeg /opt/ffmpeg/bin/ffprobe /usr/local/bin/
COPY --from=media-build /opt/ffmpeg/share/panthorium/ /usr/local/share/panthorium/
WORKDIR /app
COPY package*.json ./
# Package managers are build tools; the runtime starts Node directly.
# Remove their separate dependency trees after the locked application install.
RUN npm ci --omit=dev --ignore-scripts \
    && npm cache clean --force \
    && node -e "const fs = require('node:fs'); for (const p of ['/usr/local/lib/node_modules/npm', '/opt/yarn-v' + process.env.YARN_VERSION, '/usr/local/bin/npm', '/usr/local/bin/npx', '/usr/local/bin/yarn', '/usr/local/bin/yarnpkg']) fs.rmSync(p, { recursive: true, force: true });"
COPY . .
# Validate required static assets inside the actual filtered image context.
RUN node -e "const { CloudAppCatalog } = require('./services/cloudAppCatalog'); if (!new CloudAppCatalog().list().packs.length) throw new Error('Cloud app catalog missing');"
# Source and dependencies stay root-owned; only runtime state is writable.
RUN mkdir -p /app/data /app/logs && chown node:node /app/data /app/logs
ENV NODE_ENV=production
USER node
EXPOSE 8787
CMD ["node", "server.js"]
