# PVPN — Docker image with Tor installed so geo-exit VPN works on Render.
FROM node:22-bookworm-slim

# Install Tor (apt-get is available on Debian bookworm slim).
RUN apt-get update \
  && apt-get install -y --no-install-recommends tor=0.4.8.* \
  && rm -rf /var/lib/apt/lists/*

# Create a non-root user for the app.
RUN useradd -m -u 1001 appuser

WORKDIR /app

# Install dependencies first (leverage Docker layer caching).
COPY package.json package-lock.json ./
RUN npm ci --omit=dev || npm install --omit=dev

# Copy app source.
COPY . .

# Tor data dirs must be writable by appuser.
RUN mkdir -p .tor-exits /var/lib/tor /var/run/tor \
  && chown -R appuser:appuser .tor-exits /var/lib/tor /var/run/tor /app

USER appuser

# Entrypoint: start system tor in the background, then launch the node server.
# The proxy uses the system Tor SOCKS port (9050) when vpnMode='builtin'.
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 3000
ENV PORT=3000

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
