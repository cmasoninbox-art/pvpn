/**
 * PVPN Loot Crate System — animated crate openings with tier-based prizes
 *
 * Crate tiers:
 *   Bronze  $2    — common junk
 *   Silver  $5    — better odds
 *   Gold    $15   — rare items
 *   Diamond $50   — legendary items
 *
 * Item rarities:
 *   Common    (grey)    50%  — junk items
 *   Uncommon  (green)   25%  — decent items
 *   Rare      (blue)    15%  — good items
 *   Epic      (purple)   8%  — great items
 *   Legendary (gold)     2%  — top items
 *
 * Items include: used condoms, tissues, socks, stickers, VPN credits, etc.
 */
(function() {
  'use strict';

  // ─── ITEM DATABASE ──────────────────────────────────────────────
  const ITEMS = [
    // COMMON (50%)
    { id: 'tissue_used', name: 'Used Tissue', emoji: '🤧', rarity: 'common', desc: 'Gently used. Still slightly damp. A true collector\'s item.', value: 0 },
    { id: 'tissue_premium', name: 'Premium Tissue', emoji: '🧻', rarity: 'common', desc: 'The good stuff. Soft, absorbent, and barely touched.', value: 0 },
    { id: 'condom_used', name: 'Used Condom', emoji: '🩲', rarity: 'common', desc: 'Someone had a good time. Now it\'s yours. Congratulations?', value: 0 },
    { id: 'crumb_packet', name: 'Chip Crumbs', emoji: '🍟', rarity: 'common', desc: 'The bottom of the bag. Salty goodness. No actual chips.', value: 0 },
    { id: 'penny', name: 'One Penny', emoji: '🪙', rarity: 'common', desc: 'A whole penny. You\'re basically rich now.', value: 1 },
    { id: 'sticker_basic', name: 'PVPN Sticker', emoji: '🏷️', rarity: 'common', desc: 'Slap it on your laptop. Tell the world you browse free.', value: 0 },
    { id: 'rubber_band', name: 'Old Rubber Band', emoji: '🔗', rarity: 'common', desc: 'Still stretches. Mostly. Good for... things.', value: 0 },
    { id: 'lucky_penny', name: 'Lucky Penny (Heads)', emoji: '🪙', rarity: 'common', desc: 'It\'s heads! You\'re lucky! (It\'s still just a penny.)', value: 1 },
    { id: 'breath_mint', name: 'Half-Used Breath Mint', emoji: '🍬', rarity: 'common', desc: 'Someone started this. Now you finish it. Teamwork.', value: 0 },
    { id: 'napkin', name: 'Slightly Dirty Napkin', emoji: '🧻', rarity: 'common', desc: 'Has a small stain on it. Character building.', value: 0 },

    // UNCOMMON (25%)
    { id: 'sock_basic', name: 'Plain White Sock', emoji: '🧦', rarity: 'uncommon', desc: 'Clean-ish. One of a pair. The other one is in the void.', value: 0 },
    { id: 'vpn_1day', name: 'VPN 1-Day Pass', emoji: '🔑', rarity: 'uncommon', desc: '24 hours of premium VPN. Use it wisely.', value: 5 },
    { id: 'sticker_rare', name: 'Holographic PVPN Sticker', emoji: '✨', rarity: 'uncommon', desc: 'It sparkles. It shines. It screams "I have good taste."', value: 0 },
    { id: 'cookie_crumbs', name: 'Cookie Crumbs', emoji: '🍪', rarity: 'uncommon', desc: 'The cookie is gone. But the crumbs remember.', value: 0 },
    { id: 'pencil_stub', name: 'Pencil Stub', emoji: '✏️', rarity: 'uncommon', desc: '3 inches of pure writing potential. No eraser though.', value: 0 },
    { id: 'gum_wrapper', name: 'Foil Gum Wrapper', emoji: '🪩', rarity: 'uncommon', desc: 'Shiny. Fold it into a tiny swan. Impress no one.', value: 0 },
    { id: 'USB_drive', name: 'Mystery USB Drive', emoji: '💾', rarity: 'uncommon', desc: 'Don\'t plug it in. Or do. We\'re not your parents.', value: 0 },
    { id: 'qr_sticker', name: 'QR Code Sticker', emoji: '📱', rarity: 'uncommon', desc: 'Scans to... this website. Full circle.', value: 0 },

    // RARE (15%)
    { id: 'sock_pair', name: 'Matched Sock Pair', emoji: '🧦', rarity: 'rare', desc: 'Two socks. That match. In the same place. miracles happen.', value: 10 },
    { id: 'vpn_7day', name: 'VPN 7-Day Pass', emoji: '🔑', rarity: 'rare', desc: 'A full week of premium access. Treat yourself.', value: 25 },
    { id: 'used_condom_pack', name: 'Condom Multipack (Opened)', emoji: '📦', rarity: 'rare', desc: 'Started with 3. Has 1 left. Lucky you.', value: 0 },
    { id: 'energy_drink', name: 'Empty Energy Drink Can', emoji: '🥫', rarity: 'rare', desc: 'The energy is gone. But the can is still cool.', value: 0 },
    { id: 'orange_socks', name: 'VPN Orange Socks', emoji: '🧦', rarity: 'rare', desc: 'THE socks. The legendary orange ones. Slightly worn.', value: 15 },
    { id: 'coffee_mug', name: 'Chipped Coffee Mug', emoji: '☕', rarity: 'rare', desc: 'Has "World\'s Okayest Browser" written on it. Chipped rim.', value: 0 },
    { id: 'keyboard_key', name: 'Esc Keycap', emoji: '⌨️', rarity: 'rare', desc: 'The escape key. From a keyboard. Now you can escape.', value: 0 },

    // EPIC (8%)
    { id: 'jessie_sock', name: 'Jessie\'s sock (One)', emoji: '👃', rarity: 'epic', desc: 'THE sock. THE one. Authenticated. Sealed. Legendary.', value: 100 },
    { id: 'vpn_lifetime', name: 'VPN Lifetime Pass', emoji: '👑', rarity: 'epic', desc: 'Premium forever. You won the lottery. Literally.', value: 100 },
    { id: 'condom_signed', name: 'Signed Condom (by Jessie)', emoji: '✍️', rarity: 'epic', desc: 'Autographed. Never used. A piece of history.', value: 50 },
    { id: 'golden_sticker', name: 'Golden PVPN Sticker', emoji: '🥇', rarity: 'epic', desc: 'Real gold plating. Probably. Don\'t test it.', value: 30 },
    { id: 'sock_pack', name: '12-Pack Orange Socks', emoji: '🧦', rarity: 'epic', desc: 'A full dozen. One for every month of the year.', value: 80 },

    // LEGENDARY (2%)
    { id: 'jessie_pair', name: 'Jessie\'s Sock Pair (Sealed)', emoji: '🏆', rarity: 'legendary', desc: 'Both socks. Matched. Sealed in a display case. The holy grail.', value: 500 },
    { id: 'golden_condom', name: '24K Gold Condom', emoji: '✨', rarity: 'legendary', desc: 'Real gold. Never worn. Because who wears gold condoms?', value: 200 },
    { id: 'vpn_forever_plus', name: 'VPN Forever+ Pass', emoji: '💎', rarity: 'legendary', desc: 'Lifetime premium + all future features + personal shoutout.', value: 1000 },
    { id: 'jessie_hug', name: 'Jessie\'s Hug (Coupon)', emoji: '🤗', rarity: 'legendary', desc: 'A coupon for one (1) hug from Jessie. Non-transferable. No expiration.', value: 999 },
  ];

  // ─── RARITY CONFIG ─────────────────────────────────────────────
  const RARITIES = {
    common:   { label: 'Common',   color: '#888',    glow: 'rgba(136,136,136,0.4)',   chance: 0.50 },
    uncommon: { label: 'Uncommon', color: '#2ecc71', glow: 'rgba(46,204,113,0.4)',    chance: 0.25 },
    rare:     { label: 'Rare',     color: '#3498db', glow: 'rgba(52,152,219,0.4)',    chance: 0.15 },
    epic:     { label: 'Epic',     color: '#9b59b6', glow: 'rgba(155,89,182,0.5)',    chance: 0.08 },
    legendary:{ label: 'Legendary',color: '#ffd700', glow: 'rgba(255,215,0,0.6)',     chance: 0.02 },
  };

  // ─── CRATE TIERS ───────────────────────────────────────────────
  const CRATE_TIERS = {
    bronze: {
      name: 'Bronze Crate',
      price: 200, // cents
      priceLabel: '$2',
      emoji: '📦',
      color: '#cd7f32',
      itemBoost: { common: 1.2, uncommon: 1.0, rare: 0.8, epic: 0.5, legendary: 0.2 },
    },
    silver: {
      name: 'Silver Crate',
      price: 500,
      priceLabel: '$5',
      emoji: '📦',
      color: '#c0c0c0',
      itemBoost: { common: 1.0, uncommon: 1.2, rare: 1.0, epic: 0.7, legendary: 0.3 },
    },
    gold: {
      name: 'Gold Crate',
      price: 1500,
      priceLabel: '$15',
      emoji: '📦',
      color: '#ffd700',
      itemBoost: { common: 0.6, uncommon: 1.0, rare: 1.3, epic: 1.2, legendary: 0.5 },
    },
    diamond: {
      name: 'Diamond Crate',
      price: 5000,
      priceLabel: '$50',
      emoji: '📦',
      color: '#b9f2ff',
      itemBoost: { common: 0.3, uncommon: 0.7, rare: 1.2, epic: 1.5, legendary: 1.0 },
    },
  };

  // ─── ROLL AN ITEM ──────────────────────────────────────────────
  function rollItem(crateTier) {
    const boost = (CRATE_TIERS[crateTier] || CRATE_TIERS.bronze).itemBoost;
    // Weighted random
    let totalWeight = 0;
    const weights = {};
    for (const [rarity, config] of Object.entries(RARITIES)) {
      weights[rarity] = config.chance * (boost[rarity] || 1);
      totalWeight += weights[rarity];
    }
    let roll = Math.random() * totalWeight;
    let chosenRarity = 'common';
    for (const [rarity, weight] of Object.entries(weights)) {
      roll -= weight;
      if (roll <= 0) { chosenRarity = rarity; break; }
    }
    // Pick random item from that rarity
    const pool = ITEMS.filter(i => i.rarity === chosenRarity);
    return pool[Math.floor(Math.random() * pool.length)];
  }

  // ─── FIREWORKS ─────────────────────────────────────────────────
  function fireworks(color, duration) {
    const canvas = document.createElement('canvas');
    canvas.id = 'fireworks-canvas';
    canvas.style.cssText = 'position:fixed;inset:0;z-index:99999;pointer-events:none;';
    document.body.appendChild(canvas);
    const ctx = canvas.getContext('2d');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    const particles = [];
    const colors = [color, '#fff', '#ff7a00', '#ffd700', '#ff4444', '#44ff44'];

    for (let i = 0; i < 8; i++) {
      setTimeout(() => {
        const cx = Math.random() * canvas.width;
        const cy = Math.random() * canvas.height * 0.6;
        for (let j = 0; j < 60; j++) {
          const angle = Math.random() * Math.PI * 2;
          const speed = 2 + Math.random() * 6;
          particles.push({
            x: cx, y: cy,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            life: 1,
            decay: 0.01 + Math.random() * 0.02,
            color: colors[Math.floor(Math.random() * colors.length)],
            size: 2 + Math.random() * 3,
          });
        }
      }, i * (duration / 8));
    }

    function animate() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.05; // gravity
        p.life -= p.decay;
        if (p.life <= 0) { particles.splice(i, 1); continue; }
        ctx.globalAlpha = p.life;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      if (particles.length > 0) {
        requestAnimationFrame(animate);
      } else {
        canvas.remove();
      }
    }
    animate();
  }

  // ─── SPINNING CRATE ANIMATION ──────────────────────────────────
  function spinCrate(crateTier, wonItem, callback) {
    const overlay = document.createElement('div');
    overlay.id = 'crate-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:99998;background:rgba(0,0,0,0.9);display:flex;align-items:center;justify-content:center;flex-direction:column;';

    const crateInfo = CRATE_TIERS[crateTier] || CRATE_TIERS.bronze;
    const rarityInfo = RARITIES[wonItem.rarity] || RARITIES.common;

    overlay.innerHTML = `
      <div id="crate-spinner" style="position:relative;width:300px;height:400px;overflow:hidden;border-radius:12px;border:3px solid ${crateInfo.color};background:#0a0a0a;">
        <div id="spin-strip" style="position:absolute;width:100%;transition:transform 4s cubic-bezier(0.15,0.8,0.3,1);display:flex;flex-direction:column;align-items:center;">
        </div>
      </div>
      <div id="crate-label" style="margin-top:20px;color:${crateInfo.color};font-size:24px;font-weight:900;text-transform:uppercase;letter-spacing:3px;">${crateInfo.emoji} ${crateInfo.name}</div>
    `;
    document.body.appendChild(overlay);

    const strip = document.getElementById('spin-strip');

    // Build spin strip: 30 items (29 random + winner at end)
    const allItems = [];
    for (let i = 0; i < 29; i++) {
      const pool = ITEMS.filter(it => it !== wonItem);
      allItems.push(pool[Math.floor(Math.random() * pool.length)]);
    }
    allItems.push(wonItem);

    allItems.forEach((item, idx) => {
      const ri = RARITIES[item.rarity];
      const div = document.createElement('div');
      div.style.cssText = `width:260px;height:80px;margin:8px auto;display:flex;align-items:center;justify-content:center;gap:12px;background:rgba(255,255,255,0.05);border:2px solid ${ri.color};border-radius:8px;font-size:16px;color:#fff;flex-shrink:0;`;
      div.innerHTML = `<span style="font-size:40px;">${item.emoji}</span><span><b>${item.name}</b><br/><span style="color:${ri.color};font-size:11px;">${ri.label}</span></span>`;
      strip.appendChild(div);
    });

    // Start spinning
    const itemHeight = 96; // 80 + 16 margin
    const totalItems = allItems.length;
    const targetIndex = totalItems - 1;
    const offset = -(targetIndex * itemHeight);

    requestAnimationFrame(() => {
      strip.style.transform = `translateY(${offset}px)`;
    });

    // After spin completes
    setTimeout(() => {
      // Show winner
      overlay.innerHTML = `
        <div id="winner-card" style="text-align:center;animation:winnerPop 0.5s ease-out;">
          <div style="font-size:80px;margin-bottom:10px;filter:drop-shadow(0 0 20px ${rarityInfo.glow});">${wonItem.emoji}</div>
          <div style="font-size:14px;color:${rarityInfo.color};text-transform:uppercase;letter-spacing:3px;margin-bottom:6px;">${rarityInfo.label}</div>
          <div style="font-size:28px;font-weight:900;color:#fff;margin-bottom:8px;">${wonItem.name}</div>
          <div style="font-size:13px;color:#aaa;max-width:300px;margin:0 auto 16px;line-height:1.5;">${wonItem.desc}</div>
          <div style="font-size:12px;color:${rarityInfo.color};margin-bottom:20px;">${wonItem.value > 0 ? 'Value: $' + wonItem.value : 'Priceless (literally)'}</div>
          <button id="winner-close" style="background:${rarityInfo.color};color:#000;border:0;padding:12px 28px;border-radius:6px;font-weight:900;text-transform:uppercase;cursor:pointer;font-size:14px;">Claim Prize</button>
        </div>
      `;

      // Add winner pop animation
      const s = document.createElement('style');
      s.textContent = `
        @keyframes winnerPop {
          0% { transform: scale(0.3); opacity: 0; }
          60% { transform: scale(1.1); }
          100% { transform: scale(1); opacity: 1; }
        }
      `;
      document.head.appendChild(s);

      // Fireworks!
      fireworks(rarityInfo.color, 3000);

      document.getElementById('winner-close').addEventListener('click', () => {
        overlay.remove();
        s.remove();
        if (callback) callback(wonItem);
      });
    }, 4500); // Wait for spin animation
  }

  // ─── CREATE CRATE UI ──────────────────────────────────────────
  function createCrateUI() {
    const crate = document.createElement('div');
    crate.id = 'pvpn-crate';
    crate.innerHTML = `
      <div id="crate-btn" title="Open Crate">🎰</div>
      <div id="crate-panel" style="display:none;">
        <div id="crate-panel-header">
          <span style="font-weight:900;color:#ffd700;text-transform:uppercase;letter-spacing:1px;">🎰 Loot Crates</span>
          <button id="crate-close" style="background:transparent;border:0;color:#ff7a00;cursor:pointer;font-size:18px;font-weight:900;">×</button>
        </div>
        <div id="crate-options"></div>
      </div>
    `;
    document.body.appendChild(crate);

    // Style
    const style = document.createElement('style');
    style.textContent = `
      #pvpn-crate {
        position: fixed;
        bottom: 20px;
        left: 20px;
        z-index: 8500;
      }
      #crate-btn {
        width: 50px;
        height: 50px;
        background: rgba(10,10,10,0.8);
        border: 2px solid #ffd700;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 24px;
        cursor: pointer;
        box-shadow: 0 0 20px rgba(255,215,0,0.3);
        transition: transform 0.2s, box-shadow 0.2s;
        backdrop-filter: blur(4px);
      }
      #crate-btn:hover { transform: scale(1.1); box-shadow: 0 0 30px rgba(255,215,0,0.5); }
      #crate-panel {
        position: absolute;
        bottom: 60px;
        left: 0;
        width: 280px;
        background: rgba(10,10,10,0.9);
        backdrop-filter: blur(8px);
        border: 1px solid rgba(255,215,0,0.4);
        border-radius: 10px;
        overflow: hidden;
      }
      #crate-panel-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 10px 14px;
        background: rgba(255,215,0,0.1);
        border-bottom: 1px solid rgba(255,215,0,0.2);
      }
      #crate-options {
        padding: 10px;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .crate-tier-btn {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 10px 14px;
        border-radius: 8px;
        border: 2px solid;
        background: rgba(0,0,0,0.3);
        cursor: pointer;
        transition: transform 0.15s, box-shadow 0.15s;
        color: #fff;
      }
      .crate-tier-btn:hover { transform: translateY(-2px); }
      .crate-tier-btn .crate-price { margin-left: auto; font-weight: 900; font-size: 14px; }
      .crate-tier-btn .crate-name { font-weight: 700; font-size: 13px; }
      .crate-tier-btn .crate-desc { font-size: 10px; color: #888; }
    `;
    document.head.appendChild(style);

    // Build crate options
    const optionsDiv = document.getElementById('crate-options');
    const descriptions = {
      bronze: 'Mostly junk. Some hope.',
      silver: 'Better odds. Still risky.',
      gold: 'Rare items inside.',
      diamond: 'Legendary tier. Go big.',
    };
    for (const [key, tier] of Object.entries(CRATE_TIERS)) {
      const btn = document.createElement('button');
      btn.className = 'crate-tier-btn';
      btn.style.borderColor = tier.color;
      btn.innerHTML = `
        <div>
          <div class="crate-name" style="color:${tier.color}">${tier.emoji} ${tier.name}</div>
          <div class="crate-desc">${descriptions[key]}</div>
        </div>
        <span class="crate-price" style="color:${tier.color}">${tier.priceLabel}</span>
      `;
      btn.addEventListener('click', () => openCrate(key));
      optionsDiv.appendChild(btn);
    }

    // Toggle panel
    document.getElementById('crate-btn').addEventListener('click', () => {
      const panel = document.getElementById('crate-panel');
      panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
    });
    document.getElementById('crate-close').addEventListener('click', () => {
      document.getElementById('crate-panel').style.display = 'none';
    });
  }

  // ─── OPEN CRATE ───────────────────────────────────────────────
  function openCrate(crateTier) {
    const tier = CRATE_TIERS[crateTier];
    // In production: POST /api/crate/open with Stripe payment verification
    // For now: simulate purchase
    const confirmed = confirm(`Open ${tier.name} for ${tier.priceLabel}?`);
    if (!confirmed) return;

    const wonItem = rollItem(crateTier);
    spinCrate(crateTier, wonItem, (item) => {
      // Store won item
      try {
        const inv = JSON.parse(localStorage.getItem('crateInventory') || '[]');
        inv.push({ ...item, wonAt: Date.now() });
        localStorage.setItem('crateInventory', JSON.stringify(inv));
        if (item.id === 'sock_pair' || item.id === 'orange_socks' || item.id === 'sock_pack') {
          localStorage.setItem('hasSocks', '1');
        }
        if (item.id === 'vpn_lifetime' || item.id === 'vpn_forever_plus') {
          localStorage.setItem('premium', '1');
        }
      } catch(_) {}
      console.log(`[Crate] Won: ${item.name} (${item.rarity})`);
    });

    // Close the crate panel
    document.getElementById('crate-panel').style.display = 'none';
  }

  // ─── INIT ──────────────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', createCrateUI);
  } else {
    createCrateUI();
  }

  window.PVPNCrate = { openCrate, rollItem, ITEMS, RARITIES, CRATE_TIERS };
})();
