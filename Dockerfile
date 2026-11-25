FROM node:24-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    TZ=Asia/Taipei \
    EVENTFLOW_DATA_DIR=/app/data \
    EVENTFLOW_UPLOADS_DIR=/app/data/uploads \
    BACKUP_DIR=/app/data/backups \
    COOKIE_SECURE=1 \
    ALLOW_REMOTE_SETUP=0

COPY package.json package-lock.json ./

RUN npm ci --omit=dev

COPY --chown=node:node server.js ./
COPY --chown=node:node modules ./modules
COPY --chown=node:node public ./public
COPY --chown=node:node scripts ./scripts

RUN mkdir -p /app/data/uploads /app/data/backups \
    && chown -R node:node /app/data \
    && chmod 700 /app/data

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]