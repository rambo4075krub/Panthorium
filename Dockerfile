FROM node:24.22.1-alpine
RUN apk add --no-cache ffmpeg
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY . .
# Validate required static assets inside the actual filtered image context.
RUN node -e "const { CloudAppCatalog } = require('./services/cloudAppCatalog'); if (!new CloudAppCatalog().list().packs.length) throw new Error('Cloud app catalog missing');"
# Source and dependencies stay root-owned; only runtime state is writable.
RUN mkdir -p /app/data /app/logs && chown node:node /app/data /app/logs
ENV NODE_ENV=production
USER node
EXPOSE 8787
CMD ["node", "server.js"]
