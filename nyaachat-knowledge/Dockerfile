# syntax=docker/dockerfile:1.7
# Single-stage build on debian-slim. better-sqlite3 and sqlite-vec both ship
# prebuilt linux-x64 binaries that depend on glibc, so we cannot use alpine
# (musl) without compiling from source. NyaaLibrary-MCP uses the same base for
# the same reason.
FROM node:20-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm install --omit=dev --prefer-offline
COPY src ./src

# db file and vector store live on bind-mounted host volumes (see
# docker-compose.knowledge.yml); these are just the in-container mount points.
ENV DB_PATH=/data/db/nyaachat-knowledge.db
ENV PORT=5108

EXPOSE 5108
CMD ["npm", "start"]
