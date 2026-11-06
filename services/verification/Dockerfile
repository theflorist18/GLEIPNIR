FROM node:20.19-alpine
WORKDIR /app
# Lockfile-exact install so the image is reproducible from a given commit:
# npm ci fails on lockfile drift instead of re-resolving dependencies.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
EXPOSE 4004
# /verify-metrics is a named volume (verify-metrics) for the per-request
# audit-latency step log; create+chown the mountpoint so the fresh volume
# initialises as node-owned and the service can append to it (same pattern as
# receipt-store / evidence-store). Without this the volume mounts root-owned and every append
# silently fails, producing empty verifySteps.
RUN mkdir -p /verify-metrics && chown -R node:node /verify-metrics
USER node
CMD ["node", "src/index.js"]
