# Build stage
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

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