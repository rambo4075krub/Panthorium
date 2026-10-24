FROM node:24.22.1-alpine AS media-build
RUN apk add --no-cache build-base pkgconf nasm patch x264-dev opus-dev libass-dev zlib-dev
COPY build/media/ /build/media/
RUN node /build/media/build-ffmpeg.mjs

FROM node:24.22.1-alpine AS runtime
# Only the libraries used by the reviewed CPU/local-file build, plus captions.
RUN apk add --no-cache x264-libs opus libass zlib font-dejavu font-noto-thai
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
