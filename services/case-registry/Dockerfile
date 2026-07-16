FROM node:20.19-slim
# Deliberate deviation from the node:20.19-alpine convention used by every
# other service: better-sqlite3 ships prebuilt glibc binaries, which Debian
# slim consumes directly — alpine (musl) would force a from-source node-gyp
# build. Documented in this service's README.
WORKDIR /app
# Lockfile-exact install: the image must be byte-reproducible from the cited
# commit (audit F58) — npm ci fails loudly on lockfile drift, never re-resolves.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
ENV DATA_DIR=/data
EXPOSE 4005
# /data is a named volume (case-registry-data); ensure the node user can write it.
RUN mkdir -p /data && chown -R node:node /data
USER node
CMD ["node", "src/index.js"]
