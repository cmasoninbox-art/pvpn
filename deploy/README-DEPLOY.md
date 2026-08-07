# VPN Browser — going live (backend install)

**WordPress? No.** This app is a Node.js server-side proxy (fetch + rewrite +
Tor egress). WordPress runs PHP — it cannot run or host this. Shared/cPanel
hosting won't work either. It needs a Node runtime on a box you control:
a VPS, a Docker host, or your own machine exposed via tunnel.

## Option A — VPS (recommended, ~$4-6/mo: Hetzner, DigitalOcean, Vultr, Racknerd)

On a fresh Ubuntu 22.04/24.04 VPS:

    sudo bash deploy-vps.sh

That one command: installs node 20 + tor, copies the app to /opt/vpn-browser,
creates a dedicated user, generates a random SESSION_SECRET, asks you to set
the admin password, installs + enables a systemd service (auto-start on boot,
auto-restart on crash), opens port 3000, and prints your public URL.

For HTTPS + a real domain, put caddy or nginx in front (Caddy: one line,
`caddy reverse-proxy --from yourdomain.com --to localhost:3000`, free certs).

## Option B — Docker

    docker build -f deploy/Dockerfile -t vpn-browser .
    ADMIN_PASS='<strong>' SESSION_SECRET="$(openssl rand -hex 32)" \
      docker compose -f deploy/docker-compose.yml up -d

Persists config.json + banner uploads via bind mounts.

## Option C — instant public URL, no server (Cloudflare quick tunnel)

    # on the Windows box where it already runs on localhost:3000 (WSL)
    curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o cloudflared
    chmod +x cloudflared
    ./cloudflared tunnel --url http://localhost:3000

Prints a random public https URL. URL changes on restart (quick tunnel);
a named tunnel + your own domain gives a fixed URL.

## Security checklist before exposing publicly

- [ ] SESSION_SECRET is a random 64-hex string (env var — now supported)
- [ ] ADMIN_PASS / ADMIN_USER are NOT the defaults (env vars — now supported)
- [ ] HTTPS in front (Caddy/nginx/Cloudflare) — admin cookie has no Secure flag yet
- [ ] The built-in Tor egress needs `tor` installed on the server (deploy-vps.sh does this)
