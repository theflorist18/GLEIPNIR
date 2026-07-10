# Build stage — pinned Node 20.19 (CLAUDE.md target runtime).
FROM node:20.19-alpine AS build
WORKDIR /app
# Lockfile-exact install; no npm-install fallback — a silent re-resolve would
# defeat the commit-cited reproducibility story (audit F69).
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# Serve stage — static SPA behind nginx, proxies /api -> gateway:3000.
FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8081
CMD ["nginx", "-g", "daemon off;"]
