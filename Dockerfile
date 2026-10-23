FROM node:24.22.1-alpine
RUN apk add --no-cache ffmpeg
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
