FROM node:20.19-slim
# Debian slim instead of the node:20.19-alpine base the other services use:
# better-sqlite3 v12 ships no prebuilt binary for Node 20 (ABI 115), so the
# native module is compiled at image build, and node-gyp works cleanly with
# the glibc toolchain. The toolchain is installed and purged in the same layer
# to keep the runtime image small. See this service's README.
WORKDIR /app
# Lockfile-exact install so the image is reproducible from a given commit:
# npm ci fails on lockfile drift instead of re-resolving dependencies.
COPY package.json package-lock.json ./
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && npm ci --omit=dev \
 && apt-get purge -y --auto-remove python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
COPY src ./src
EXPOSE 4005
# /data is a named volume (case-registry-data); ensure the node user can write it.
RUN mkdir -p /data && chown -R node:node /data
USER node
CMD ["node", "src/index.js"]
