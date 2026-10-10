FROM node:20-slim

# Install official Google Chrome system dependencies and clean up (refer to official documentation for the full list of packages like libglib2.0-0, libnspr4, etc.)
RUN apt-get update && apt-get install -y wget gnupg ca-certificates --no-install-recommends && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm ci
RUN npx puppeteer browsers install chrome
COPY . .
CMD ["node", "index.js"]
