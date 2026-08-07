/**
 * PVPN Ad Manager — Multi-network ad loader
 * Handles: ExoClick, TrafficStars, Adsterra, JuicyAds, ClickAdu,
 *          PropellerAds, HilltopAds, AdCash, RichAds, EroAdvertising
 *
 * Features:
 *  - Lazy-loads network tags based on admin config
 *  - Popunder cap: max 1 per user per 24h (configurable)
 *  - Push notification opt-in (PropellerAds / Adsterra)
 *  - Responsive slot sizing
 *  - Admin-controllable via /api/ad-config
 */

(function() {
  'use strict';

  // ─── STATE ────────────────────────────────────────────────────────
  const ADMANAGER = {
    config: null,
    loaded: new Set(),
    popunderFired: false,
  };

  // ─── POPUNDER TRACKING ────────────────────────────────────────────
  function canFirePopunder() {
    try {
      const last = parseInt(localStorage.getItem('pvpn_pop_ts') || '0', 10);
      const cap = (ADMANAGER.config && ADMANAGER.config.popunderCap) || 86400000; // 24h default
      if (Date.now() - last < cap) return false;
      localStorage.setItem('pvpn_pop_ts', String(Date.now()));
      return true;
    } catch (_) { return true; }
  }

  // ─── NETWORK LOADERS ──────────────────────────────────────────────
  const NETWORKS = {

    // ── ExoClick ──
    exoclick: {
      zones: ['exoclick_banner_top', 'exoclick_banner_left', 'exoclick_banner_right', 'exoclick_popunder'],
      loadBanner(container, zoneId) {
        if (!zoneId) return;
        const iframe = document.createElement('iframe');
        iframe.src = `//www.exoclick.com/ad-iframe/${zoneId}/`;
        iframe.setAttribute('frameborder', '0');
        iframe.setAttribute('scrolling', 'no');
        iframe.style.cssText = 'width:100%;height:100%;border:0;min-height:90px;';
        container.appendChild(iframe);
      },
      loadPopunder(zoneId) {
        if (!zoneId || !canFirePopunder()) return;
        const s = document.createElement('script');
        s.src = `//www.exoclick.com/popunder/${zoneId}/`;
        s.async = true;
        document.body.appendChild(s);
      }
    },

    // ── TrafficStars ──
    trafficstars: {
      zones: ['trafficstars_banner_top', 'trafficstars_banner_left', 'trafficstars_banner_right'],
      loadBanner(container, zoneId) {
        if (!zoneId) return;
        const div = document.createElement('div');
        div.setAttribute('data-zone', zoneId);
        div.className = 'trafficstars-zone';
        div.style.cssText = 'width:100%;min-height:90px;';
        container.appendChild(div);
        // Load TrafficStars lib
        if (!document.getElementById('ts-lib')) {
          const s = document.createElement('script');
          s.id = 'ts-lib';
          s.src = 'https://cdn.trafficstars.com/load/tags.js';
          s.async = true;
          document.body.appendChild(s);
        }
      }
    },

    // ── Adsterra ──
    adsterra: {
      zones: ['adsterra_banner_top', 'adsterra_banner_left', 'adsterra_banner_right', 'adsterra_popunder', 'adsterra_push'],
      loadBanner(container, zoneId) {
        if (!zoneId) return;
        const s = document.createElement('script');
        s.textContent = `(atOptions = { key: '${zoneId}', format: 'iframe', height: 90, width: 728, params: {} });`;
        container.appendChild(s);
        const s2 = document.createElement('script');
        s2.src = '//www.topcreativeformat.com/' + zoneId + '/invoke.js';
        s2.async = true;
        container.appendChild(s2);
      },
      loadPopunder(zoneId) {
        if (!zoneId || !canFirePopunder()) return;
        const s = document.createElement('script');
        s.textContent = `(atOptions = { key: '${zoneId}', format: 'popunder', params: {} });`;
        document.body.appendChild(s);
        const s2 = document.createElement('script');
        s2.src = '//www.topcreativeformat.com/' + zoneId + '/invoke.js';
        s2.async = true;
        document.body.appendChild(s2);
      },
      loadPush(zoneId) {
        if (!zoneId) return;
        // Adsterra push SW registration
        if ('serviceWorker' in navigator) {
          navigator.serviceWorker.register('/sw-adsterra.js').catch(() => {});
        }
      }
    },

    // ── JuicyAds ──
    juicyads: {
      zones: ['juicyads_banner_top', 'juicyads_banner_left', 'juicyads_banner_right'],
      loadBanner(container, zoneId) {
        if (!zoneId) return;
        const a = document.createElement('a');
        a.href = `//www.juicyads.com/publishers/${zoneId}`;
        a.target = '_blank';
        a.rel = 'noopener';
        const img = document.createElement('img');
        img.src = `//ads.juicyads.com/get_ad.php?id=${zoneId}`;
        img.style.cssText = 'max-width:100%;height:auto;border:0;';
        img.onerror = function() { this.parentElement.style.display = 'none'; };
        a.appendChild(img);
        container.appendChild(a);
      }
    },

    // ── ClickAdu ──
    clickadu: {
      zones: ['clickadu_popunder'],
      loadPopunder(zoneId) {
        if (!zoneId || !canFirePopunder()) return;
        const s = document.createElement('script');
        s.src = `//d2bf61947c/${zoneId}/tag.min.js`;
        s.async = true;
        document.body.appendChild(s);
      }
    },

    // ── PropellerAds ──
    propellerads: {
      zones: ['propellerads_popunder', 'propellerads_push'],
      loadPopunder(zoneId) {
        if (!zoneId || !canFirePopunder()) return;
        const s = document.createElement('script');
        s.src = `//nickameled.com/${zoneId}/var.js`;
        s.async = true;
        document.body.appendChild(s);
      },
      loadPush(zoneId) {
        if (!zoneId) return;
        // PropellerAds SW push
        const s = document.createElement('script');
        s.src = `//nickameled.com/${zoneId}/sw.js`;
        s.async = true;
        document.body.appendChild(s);
      }
    },

    // ── HilltopAds ──
    hilltopads: {
      zones: ['hilltopads_popunder', 'hilltopads_push'],
      loadPopunder(zoneId) {
        if (!zoneId || !canFirePopunder()) return;
        const s = document.createElement('script');
        s.src = `//hilltopads.com/script/${zoneId}.js`;
        s.async = true;
        document.body.appendChild(s);
      },
      loadPush(zoneId) {
        if (!zoneId) return;
        const s = document.createElement('script');
        s.src = `//hilltopads.com/push/${zoneId}.js`;
        s.async = true;
        document.body.appendChild(s);
      }
    },

    // ── AdCash ──
    adcash: {
      zones: ['adcash_banner_top', 'adcash_popunder'],
      loadBanner(container, zoneId) {
        if (!zoneId) return;
        const s = document.createElement('script');
        s.src = `//ad.adcash.com/sua.js?key=${zoneId}&format=728x90`;
        s.async = true;
        container.appendChild(s);
      },
      loadPopunder(zoneId) {
        if (!zoneId || !canFirePopunder()) return;
        const s = document.createElement('script');
        s.src = `//ad.adcash.com/sua.js?key=${zoneId}&format=popunder`;
        s.async = true;
        document.body.appendChild(s);
      }
    },

    // ── RichAds ──
    richads: {
      zones: ['richads_popunder'],
      loadPopunder(zoneId) {
        if (!zoneId || !canFirePopunder()) return;
        const s = document.createElement('script');
        s.src = `//richads.com/js/popup.js?id=${zoneId}`;
        s.async = true;
        document.body.appendChild(s);
      }
    },

    // ── EroAdvertising ──
    eroadvertising: {
      zones: ['ero_banner_top', 'ero_banner_left', 'ero_banner_right'],
      loadBanner(container, zoneId) {
        if (!zoneId) return;
        const a = document.createElement('a');
        a.href = `//www.erodynamic.net/click/${zoneId}`;
        a.target = '_blank';
        a.rel = 'noopener';
        const img = document.createElement('img');
        img.src = `//ads.erodynamic.net/display/${zoneId}/728x90`;
        img.style.cssText = 'max-width:100%;height:auto;border:0;';
        img.onerror = function() { this.parentElement.style.display = 'none'; };
        a.appendChild(img);
        container.appendChild(a);
      }
    }
  };

  // ─── GENERIC BANNER INJECTOR ──────────────────────────────────────
  function injectBanner(containerId, networkName, zoneId) {
    const container = document.getElementById(containerId);
    if (!container || !zoneId) return;
    const net = NETWORKS[networkName];
    if (net && net.loadBanner) {
      net.loadBanner(container, zoneId);
      ADMANAGER.loaded.add(networkName + ':' + containerId);
    }
  }

  // ─── LOAD ALL AD SLOTS FROM CONFIG ────────────────────────────────
  function loadAllAds(config) {
    if (!config || !config.networks) return;
    ADMANAGER.config = config;

    const nets = config.networks;

    // Banner slots: top, left, right
    ['top', 'left', 'right'].forEach(slot => {
      Object.keys(nets).forEach(netName => {
        const net = nets[netName];
        if (!net || !net.enabled) return;
        const zoneKey = netName + '_banner_' + slot;
        const zoneId = net.zones && net.zones[zoneKey];
        if (zoneId) {
          injectBanner('ad-slot-' + slot, netName, zoneId);
        }
      });
    });

    // Popunders (one per 24h cap, first enabled wins)
    if (config.popunderEnabled !== false) {
      let firedPopunder = false;
      Object.keys(nets).forEach(netName => {
        if (firedPopunder) return;
        const net = nets[netName];
        if (!net || !net.enabled) return;
        const popZone = net.zones && net.zones[netName + '_popunder'];
        if (popZone && net.formats && net.formats.includes('popunder')) {
          if (NETWORKS[netName] && NETWORKS[netName].loadPopunder) {
            // Fire on first user interaction (prevents browser blocking)
            const firePop = () => {
              if (!firedPopunder) {
                firedPopunder = true;
                NETWORKS[netName].loadPopunder(popZone);
                document.removeEventListener('click', firePop);
                document.removeEventListener('touchstart', firePop);
              }
            };
            document.addEventListener('click', firePop, { once: false });
            document.addEventListener('touchstart', firePop, { once: false });
          }
        }
      });
    }

    // Push notification opt-in
    Object.keys(nets).forEach(netName => {
      const net = nets[netName];
      if (!net || !net.enabled) return;
      const pushZone = net.zones && net.zones[netName + '_push'];
      if (pushZone && net.formats && net.formats.includes('push')) {
        if (NETWORKS[netName] && NETWORKS[netName].loadPush) {
          NETWORKS[netName].loadPush(pushZone);
        }
      }
    });
  }

  // ─── INIT ─────────────────────────────────────────────────────────
  function init() {
    // Load config from server
    fetch('/api/ad-config')
      .then(r => r.json())
      .then(config => {
        if (config && config.networks) {
          loadAllAds(config);
        }
      })
      .catch(() => {
        // Fallback: use inline config from data attribute
        const el = document.getElementById('ad-manager-config');
        if (el) {
          try {
            loadAllAds(JSON.parse(el.textContent));
          } catch (_) {}
        }
      });
  }

  // ─── EXPOSE ───────────────────────────────────────────────────────
  window.PVPNAds = {
    init: init,
    loadAll: loadAllAds,
    config: () => ADMANAGER.config,
  };

  // Auto-init when DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
