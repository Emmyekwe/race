# Frontend: build the Vite app, then serve the static files with nginx.
# nginx also reverse-proxies /api and /socket.io to the backend, so the
# browser talks to a single origin exactly as it does with the Vite dev proxy.
# Build context is the repository root (see docker-compose.yml).

FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci --workspace client --include-workspace-root=false
COPY client ./client
RUN npm run build --workspace client

FROM nginx:1.27-alpine AS runtime
COPY client/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/client/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=15s --timeout=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1
