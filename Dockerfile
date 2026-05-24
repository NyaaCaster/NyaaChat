# syntax=docker/dockerfile:1.7
# Build stage
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
# Cache mount on /root/.npm so `npm ci` reuses already-downloaded
# tarballs across rebuilds even when this layer's hash changes (e.g.
# package.json edits). --prefer-offline tells npm to try the cache
# before hitting the network.
RUN --mount=type=cache,target=/root/.npm \
    npm ci --prefer-offline
COPY . .
# Cache mount on Vite's dep pre-bundle dir so `npm run build` reuses
# already-bundled deps when only application source has changed. Does
# not affect Rollup's main transform pass (no disk cache there).
RUN --mount=type=cache,target=/app/node_modules/.vite \
    npm run build

# Production stage
FROM nginx:1.27-alpine
COPY --from=builder /app/dist /usr/share/nginx/html
# nginx.conf is treated as an envsubst template at container start. The
# base image's docker-entrypoint.d/20-envsubst-on-templates.sh script
# renders /etc/nginx/templates/*.template into /etc/nginx/conf.d/, with
# the MCP_-prefixed vars from docker-compose substituted in (filter set
# via NGINX_ENVSUBST_FILTER).
COPY nginx.conf /etc/nginx/templates/default.conf.template
EXPOSE 3095
CMD ["nginx", "-g", "daemon off;"]
