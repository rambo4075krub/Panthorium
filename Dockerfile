FROM node:20-alpine
RUN apk add --no-cache ffmpeg
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
# Validate required static assets inside the actual filtered image context.
RUN node -e "const { CloudAppCatalog } = require('./services/cloudAppCatalog'); if (!new CloudAppCatalog().list().packs.length) throw new Error('Cloud app catalog missing');"
ENV NODE_ENV=production
EXPOSE 8787
CMD ["node", "server.js"]
