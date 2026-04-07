FROM node:24-alpine

WORKDIR /app

COPY package.standalone.json ./package.json

RUN npm install --omit=dev

COPY src ./src

RUN mkdir -p /app/data

ENV NODE_ENV=production

CMD ["node", "src/keepalive.mjs"]
