# syntax=docker/dockerfile:1.7
# Build stage — compiles better-sqlite3's native addon against musl. alpine
# has no prebuilt better-sqlite3 binary, so node-gyp needs python3/make/g++.
FROM node:20-alpine AS builder
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm install --omit=dev --prefer-offline

# Production stage — only ships the runtime, not the toolchain. The native
# .node binary built above runs as-is on the same alpine base.
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src

# db file and cover images live on bind-mounted host volumes (see
# docker-compose.shared.yml); these are just the in-container mount points.
ENV DB_PATH=/data/db/nyaachat-shared.db
ENV COVERS_DIR=/data/covers
ENV PORT=5107

EXPOSE 5107
CMD ["npm", "start"]
