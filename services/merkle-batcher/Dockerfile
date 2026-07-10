FROM node:20.19-alpine
WORKDIR /app
# Lockfile-exact install: the image must be byte-reproducible from the cited
# commit (audit F58) — npm ci fails loudly on lockfile drift, never re-resolves.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
EXPOSE 4001
USER node
CMD ["node", "src/index.js"]
