# Build stage — Node pinned to 20.19, the project's target runtime.
FROM node:20.19-alpine AS build
WORKDIR /app
# Lockfile-exact install; no npm-install fallback — a silent re-resolve would
# break reproducing a build from its commit.
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# Serve stage — static SPA behind nginx, proxies /api -> gateway:3000.
FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8081
