FROM node:24-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --production --registry=https://registry.npmmirror.com

COPY server.js daily.js render-html.js create-playlist.js ./
COPY public ./public
COPY data/style-pool.json ./data/style-pool.json

EXPOSE 8080

CMD ["node", "server.js"]
