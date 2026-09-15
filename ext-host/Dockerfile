# syntax=docker/dockerfile:1.7
FROM node:20-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY package.json ./
COPY src ./src

EXPOSE 3099
CMD ["npm", "start"]
