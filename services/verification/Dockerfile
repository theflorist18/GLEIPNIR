FROM node:20.19-alpine
WORKDIR /app
# Lockfile-exact install: the image must be byte-reproducible from the cited
# commit (audit F58) — npm ci fails loudly on lockfile drift, never re-resolves.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
EXPOSE 4004
# /verify-metrics is a named volume (verify-metrics) for the RQ2 per-request
# step log; create+chown the mountpoint so the fresh volume initialises as
# node-owned and the service can append to it (same pattern as receipt-store /
# evidence-store). Without this the volume mounts root-owned and every append
# silently fails, producing empty verifySteps.
RUN mkdir -p /verify-metrics && chown -R node:node /verify-metrics
USER node
CMD ["node", "src/index.js"]
