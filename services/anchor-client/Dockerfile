FROM node:20.19-alpine
WORKDIR /app
# Lockfile-exact install so the image is reproducible from a given commit:
# npm ci fails on lockfile drift instead of re-resolving dependencies.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
EXPOSE 4003
USER node
CMD ["node", "src/index.js"]
