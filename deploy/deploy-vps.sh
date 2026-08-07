#!/usr/bin/env bash
# ============================================================
# VPN Browser — one-shot installer for a fresh Ubuntu VPS (22.04/24.04)
# Usage:  sudo bash deploy-vps.sh
# Does: node20 + tor, deps, /opt/vpn-browser, systemd service,
#       random session secret, admin creds prompt, ufw rule.
# ============================================================
set -euo pipefail

APP_DIR=/opt/vpn-browser
SERVICE=vpn-browser
ENV_FILE=/etc/vpn-browser.env
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ $EUID -ne 0 ]]; then echo "run as root (sudo)"; exit 1; fi

echo "==> [1/6] Installing node 20 + tor"
if ! command -v node >/dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
fi
apt-get update -y
apt-get install -y nodejs tor ca-certificates ufw

echo "==> [2/6] Copying app to $APP_DIR"
mkdir -p "$APP_DIR"
rsync -a --exclude node_modules --exclude .git --exclude deploy "$SRC_DIR"/ "$APP_DIR"/
cd "$APP_DIR"
npm ci --omit=dev || npm install --omit=dev

echo "==> [3/6] Creating dedicated user"
id -u vpnbrowser >/dev/null 2>&1 || useradd -r -m -s /usr/sbin/nologin vpnbrowser
chown -R vpnbrowser:vpnbrowser "$APP_DIR"

echo "==> [4/6] Writing secrets ($ENV_FILE)"
if [[ ! -f "$ENV_FILE" ]]; then
  umask 077
  {
    echo "NODE_ENV=production"
    echo "PORT=3000"
    echo "SESSION_SECRET=$(openssl rand -hex 32)"
    echo "ADMIN_USER=Smoke"
    read -rsp "Set admin password (hidden): " ADMIN_PASS_IN; echo
    [[ -z "$ADMIN_PASS_IN" ]] && { echo "empty password, aborting"; exit 1; }
    echo "ADMIN_PASS=$ADMIN_PASS_IN"
  } > "$ENV_FILE"
fi

echo "==> [5/6] Installing systemd service"
cat > /etc/systemd/system/$SERVICE.service <<'UNIT'
[Unit]
Description=VPN Browser Website
After=network-online.target
Wants=network-online.target

[Service]
WorkingDirectory=/opt/vpn-browser
EnvironmentFile=/etc/vpn-browser.env
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=3
User=vpnbrowser

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now $SERVICE

echo "==> [6/6] Firewall"
ufw allow 3000/tcp >/dev/null 2>&1 || true

sleep 2
IP="$(curl -4 -s ifconfig.me || hostname -I | awk '{print $1}')"
CODE="$(curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/ || true)"
echo
echo "=================================================="
echo " DONE. Local HTTP check: $CODE"
echo " Public: http://$IP:3000"
echo " Admin:  http://$IP:3000/admin   (user from $ENV_FILE)"
echo " NOTE: point a domain at $IP and put nginx/caddy"
echo "       (or Cloudflare) in front for HTTPS."
echo "=================================================="
