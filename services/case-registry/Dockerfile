FROM node:20.19-slim
# Deliberate deviation from the node:20.19-alpine convention used by every
# other service: better-sqlite3 v12 ships NO prebuilt binary for Node 20
# (ABI 115), so the native module is compiled from source at image build —
# Debian slim gives a glibc toolchain that node-gyp supports cleanly. The
# toolchain is installed and purged in the SAME layer so the runtime image
# stays lean. Documented in this service's README.
WORKDIR /app
# Lockfile-exact install: the image must be byte-reproducible from the cited
# commit (audit F58) — npm ci fails loudly on lockfile drift, never re-resolves.
COPY package.json package-lock.json ./
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && npm ci --omit=dev \
 && apt-get purge -y --auto-remove python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
COPY src ./src
ENV DATA_DIR=/data
EXPOSE 4005
# /data is a named volume (case-registry-data); ensure the node user can write it.
RUN mkdir -p /data && chown -R node:node /data
USER node
CMD ["node", "src/index.js"]
