#!/bin/sh
# PVPN container entrypoint.
# Lanes, in order:
#   1. Tor (installed via apt in the Dockerfile) — vpn-manager.js spawns its own
#      per-country SOCKS instances. We also start a base daemon on 9050 as fallback.
#   2. Tailscale (userspace, no TUN needed) — when TS_AUTHKEY is provided, we bring
#      up a WireGuard tunnel with a SOCKS5 listener on 127.0.0.1:1055. With
#      TS_EXIT_NODE set, all proxied egress exits via that node (real VPN lane).
# Both lanes are optional: without them the app still runs (direct egress).

if command -v tor >/dev/null 2>&1; then
  tor --SocksPort 9050 --DataDirectory /var/lib/tor --RunAsDaemon 1 >/dev/null 2>&1 || true
fi

if [ -n "$TS_AUTHKEY" ] && command -v tailscaled >/dev/null 2>&1; then
  mkdir -p /tmp/tailscale
  tailscaled --tun=userspace-networking \
    --socks5-server=127.0.0.1:1055 \
    --state=/tmp/tailscale/tailscaled.state \
    --socket=/tmp/tailscale/tailscaled.sock >/dev/null 2>&1 &
  TS_PID=$!
  sleep 3
  TS_ARGS="--authkey=$TS_AUTHKEY --hostname=pvpn-proxy --timeout=20s"
  if [ -n "$TS_EXIT_NODE" ]; then
    TS_ARGS="$TS_ARGS --exit-node=$TS_EXIT_NODE --exit-node-allow-lan-access"
  fi
  tailscale --socket=/tmp/tailscale/tailscaled.sock up $TS_ARGS >/dev/null 2>&1 || true
  echo "[entrypoint] tailscaled started (pid $TS_PID) — SOCKS5 on 127.0.0.1:1055"
fi

exec node server.js
