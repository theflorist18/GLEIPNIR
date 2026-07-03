FROM node:20.19-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY src ./src
EXPOSE 4004
USER node
CMD ["node", "src/index.js"]
