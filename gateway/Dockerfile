FROM node:20.19-alpine
WORKDIR /app
# Lockfile-exact install: the image must be byte-reproducible from the cited
# commit (audit F58) — npm ci fails loudly on lockfile drift, never re-resolves.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
ENV AUTH_DATA_DIR=/data/auth
EXPOSE 3000
# /data/auth is a named volume (gateway-auth-data); ensure the node user can write it.
RUN mkdir -p /data/auth && chown -R node:node /data
USER node
CMD ["node", "src/index.js"]
