# PVPN — Docker image with Tor installed so geo-exit VPN works on Render.
FROM node:22-bookworm-slim

# Install Tor (apt-get is available on Debian bookworm slim).
RUN apt-get update \
  && apt-get install -y --no-install-recommends tor=0.4.8.* \
  && rm -rf /var/lib/apt/lists/*

# Tailscale (userspace mode, no TUN device needed) — fast WireGuard VPN lane.
# The latest stable amd64 tarball is fetched dynamically so builds self-heal.
RUN set -eux; \
  curl -fsSL https://pkgs.tailscale.com/stable/ -o /tmp/ts.html; \
  TS_TGZ=$(grep -oE 'tailscale_[0-9]+\.[0-9]+\.[0-9]+_amd64\.tgz' /tmp/ts.html | sort -V | tail -1); \
  curl -fsSL "https://pkgs.tailscale.com/stable/${TS_TGZ}" -o /tmp/ts.tgz; \
  tar -xzf /tmp/ts.tgz -C /tmp; \
  cp /tmp/tailscale_*/tailscale /usr/local/bin/tailscale; \
  cp /tmp/tailscale_*/tailscaled /usr/local/bin/tailscaled; \
  chmod +x /usr/local/bin/tailscale /usr/local/bin/tailscaled; \
  rm -rf /tmp/ts.html /tmp/ts.tgz /tmp/tailscale_*

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
