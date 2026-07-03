FROM node:20.19-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY src ./src
ENV DATA_DIR=/data
EXPOSE 4002
# /data is a named volume (receipt-data); ensure the node user can write it.
RUN mkdir -p /data && chown -R node:node /data
USER node
CMD ["node", "src/index.js"]
