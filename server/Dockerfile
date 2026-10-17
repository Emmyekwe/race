# Backend: Express + Socket.io API.
# Build context is the repository root (see docker-compose.yml) so the
# workspace lockfile can be used for a reproducible `npm ci`.

FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci --omit=dev --workspace server --include-workspace-root=false \
  && npm cache clean --force

FROM node:20-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node server ./server
USER node
WORKDIR /app/server
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT:-4000}/api/health" || exit 1
CMD ["node", "server.js"]
