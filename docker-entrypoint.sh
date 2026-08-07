#!/bin/sh
# PVPN container entrypoint.
# Tor is installed via apt in the Dockerfile. The app (vpn-manager.js) spawns its own
# per-country Tor SOCKS instances, so we just need `tor` on PATH — which it is.
# Optionally start a system Tor on 9050 as a fallback SOCKS endpoint.
if command -v tor >/dev/null 2>&1; then
  # Run a base Tor daemon in the background for the system 9050 SOCKS port.
  tor --SocksPort 9050 --DataDirectory /var/lib/tor --RunAsDaemon 1 >/dev/null 2>&1 || true
fi

exec node server.js
