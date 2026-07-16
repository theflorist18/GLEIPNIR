FROM node:20.19-alpine
WORKDIR /app
# Lockfile-exact install: the image must be byte-reproducible from the cited
# commit (audit F58) — npm ci fails loudly on lockfile drift, never re-resolves.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
ENV DATA_DIR=/data
EXPOSE 4006
# /data is a named volume (evidence-blob-data); ensure the node user can write it.
RUN mkdir -p /data && chown -R node:node /data
USER node
CMD ["node", "src/index.js"]
