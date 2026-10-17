FROM ghcr.io/puppeteer/puppeteer:24.1.1

# Switch container path execution to root to enable local file system updates
USER root

WORKDIR /app

# Copy system dependency trackers
COPY package*.json ./

# Install project modules cleanly
RUN npm ci

# Copy the rest of the script application files into place
COPY --chown=pptruser:pptruser . .

# Revert execution status back to the secure system profile user account
USER pptruser

CMD ["node", "index.js"]
