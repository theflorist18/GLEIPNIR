FROM node:20.19-alpine
WORKDIR /app
# Lockfile-exact install so the image is reproducible from a given commit:
# npm ci fails on lockfile drift instead of re-resolving dependencies.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
EXPOSE 4002
# /data is a named volume (receipt-data); ensure the node user can write it.
RUN mkdir -p /data && chown -R node:node /data
USER node
CMD ["node", "src/index.js"]
