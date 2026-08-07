# VPN Browser — production container
# Build:  docker build -f deploy/Dockerfile -t vpn-browser .
# Run:    docker compose -f deploy/docker-compose.yml up -d
FROM node:20-bookworm-slim

# tor is required for the built-in VPN egress (per-country exit nodes)
RUN apt-get update \
 && apt-get install -y --no-install-recommends tor ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev || npm install --omit=dev
COPY . .

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000
CMD ["node", "server.js"]
