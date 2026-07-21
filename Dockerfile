FROM node:22-alpine

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .

RUN mkdir -p /var/lib/auction-split && chown -R node:node /var/lib/auction-split /app

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=5173
ENV DATA_DIR=/var/lib/auction-split

USER node
EXPOSE 5173
VOLUME ["/var/lib/auction-split"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD wget -qO- http://127.0.0.1:5173/api/health || exit 1

CMD ["npm", "start"]
