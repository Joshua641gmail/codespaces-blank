FROM node:22-bookworm-slim

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates git \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /data \
    && chown node:node /app /data

COPY --chown=node:node package*.json ./
USER node
RUN npm ci --omit=dev
COPY --chown=node:node . .

CMD ["node", "index.js"]
