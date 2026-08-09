/**
 * PVPN Live Chat — draggable, resizable, see-through chat box
 * Shows user tier, socks badge, real-time messages
 */
(function() {
  'use strict';

  const TIER_LABELS = {
    free: { label: 'Free', color: '#666', icon: '' },
    daily: { label: 'Daily', color: '#ff9000', icon: '⚡' },
    monthly: { label: 'Monthly', color: '#ff7a00', icon: '🔥' },
    quarterly: { label: 'Quarterly', color: '#2ecc71', icon: '💰' },
    lifetime: { label: 'Lifetime', color: '#ffd700', icon: '👑' },
    socks: { label: 'Socks', color: '#ff7a00', icon: '🧦' },
    jessie: { label: 'Jessie', color: '#e02424', icon: '👃' },
  };

  function getUserTier() {
    try {
      const premium = localStorage.getItem('premium') === '1';
      const tier = localStorage.getItem('userTier') || (premium ? 'monthly' : 'free');
      const hasSocks = localStorage.getItem('hasSocks') === '1';
      return { tier, hasSocks };
    } catch(_) { return { tier: 'free', hasSocks: false }; }
  }

  function createChat() {
    const { tier, hasSocks } = getUserTier();
    const tierInfo = TIER_LABELS[tier] || TIER_LABELS.free;

    const chat = document.createElement('div');
    chat.id = 'pvpn-chat';
    chat.innerHTML = `
      <div id="chat-header">
        <span id="chat-title">💬 Live Chat</span>
        <span id="chat-user-tier" style="color:${tierInfo.color}">
          ${tierInfo.icon} ${tierInfo.label}${hasSocks ? ' 🧦' : ''}
        </span>
        <button id="chat-minimize" title="Minimize">−</button>
        <button id="chat-close" title="Close">×</button>
      </div>
      <div id="chat-messages"></div>
      <div id="chat-input-row">
        <input id="chat-input" type="text" placeholder="Type a message..." maxlength="200" />
        <button id="chat-send">Send</button>
      </div>
    `;
    document.body.appendChild(chat);

    // Style
    const style = document.createElement('style');
    style.textContent = `
      #pvpn-chat {
        position: fixed;
        bottom: 20px;
        right: 20px;
        width: 320px;
        height: 400px;
        min-width: 220px;
        min-height: 150px;
        background: rgba(10,10,10,0.75);
        backdrop-filter: blur(8px);
        border: 1px solid rgba(255,122,0,0.4);
        border-radius: 10px;
        z-index: 8500;
        display: flex;
        flex-direction: column;
        font-family: Arial, sans-serif;
        font-size: 13px;
        color: #fff;
        box-shadow: 0 4px 24px rgba(0,0,0,0.6);
        resize: both;
        overflow: hidden;
        user-select: none;
      }
      #pvpn-chat.minimized { height: 38px !important; min-height: 38px; }
      #pvpn-chat.minimized #chat-messages,
      #pvpn-chat.minimized #chat-input-row { display: none; }
      #pvpn-chat.minimized #chat-header { border-radius: 10px; }

      #chat-header {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 6px 10px;
        background: rgba(255,122,0,0.15);
        border-bottom: 1px solid rgba(255,122,0,0.3);
        cursor: move;
        border-radius: 10px 10px 0 0;
        flex-shrink: 0;
      }
      #chat-title { flex:1; font-weight: 900; text-transform: uppercase; letter-spacing: 1px; font-size: 12px; color: #ff7a00; }
      #chat-user-tier { font-size: 11px; font-weight: 700; }
      #chat-minimize, #chat-close {
        background: transparent; border: 0; color: #ff7a00; cursor: pointer;
        font-size: 16px; font-weight: 900; padding: 0 4px; line-height: 1;
      }
      #chat-minimize:hover, #chat-close:hover { color: #fff; }

      #chat-messages {
        flex: 1;
        overflow-y: auto;
        padding: 8px;
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      #chat-messages::-webkit-scrollbar { width: 4px; }
      #chat-messages::-webkit-scrollbar-thumb { background: rgba(255,122,0,0.3); border-radius: 2px; }

      .chat-msg {
        padding: 4px 8px;
        background: rgba(255,255,255,0.05);
        border-radius: 6px;
        word-break: break-word;
        line-height: 1.4;
      }
      .chat-msg .msg-user { font-weight: 700; font-size: 11px; }
      .chat-msg .msg-tier { font-size: 10px; margin-left: 4px; }
      .chat-msg .msg-text { color: #ccc; font-size: 12px; }
      .chat-msg .msg-socks { font-size: 10px; }
      .chat-msg.system { color: #ff7a00; font-style: italic; font-size: 11px; text-align: center; }

      #chat-input-row {
        display: flex;
        gap: 4px;
        padding: 6px;
        border-top: 1px solid rgba(255,122,0,0.2);
        flex-shrink: 0;
      }
      #chat-input {
        flex: 1;
        background: rgba(0,0,0,0.5);
        border: 1px solid rgba(255,122,0,0.3);
        border-radius: 4px;
        padding: 6px 8px;
        color: #fff;
        font-size: 12px;
        outline: none;
      }
      #chat-input:focus { border-color: #ff7a00; }
      #chat-send {
        background: #ff7a00;
        color: #000;
        border: 0;
        border-radius: 4px;
        padding: 6px 10px;
        font-weight: 900;
        font-size: 11px;
        text-transform: uppercase;
        cursor: pointer;
      }
      #chat-send:hover { filter: brightness(1.1); }
    `;
    document.head.appendChild(style);

    // ─── DRAG ───
    const header = document.getElementById('chat-header');
    let isDragging = false, dragX, dragY;
    header.addEventListener('mousedown', (e) => {
      if (e.target.tagName === 'BUTTON') return;
      isDragging = true;
      dragX = e.clientX - chat.offsetLeft;
      dragY = e.clientY - chat.offsetTop;
      e.preventDefault();
    });
    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      chat.style.left = (e.clientX - dragX) + 'px';
      chat.style.top = (e.clientY - dragY) + 'px';
      chat.style.right = 'auto';
      chat.style.bottom = 'auto';
    });
    document.addEventListener('mouseup', () => { isDragging = false; });

    // ─── MINIMIZE / CLOSE ───
    document.getElementById('chat-minimize').addEventListener('click', () => {
      chat.classList.toggle('minimized');
    });
    document.getElementById('chat-close').addEventListener('click', () => {
      chat.style.display = 'none';
    });

    // ─── SEND MESSAGE ───
    const input = document.getElementById('chat-input');
    const sendBtn = document.getElementById('chat-send');
    const msgContainer = document.getElementById('chat-messages');

    function addMessage(user, text, tier, hasSocks, isSystem) {
      const div = document.createElement('div');
      div.className = 'chat-msg' + (isSystem ? ' system' : '');
      if (isSystem) {
        div.textContent = text;
      } else {
        const ti = TIER_LABELS[tier] || TIER_LABELS.free;
        div.innerHTML = `<span class="msg-user" style="color:${ti.color}">${user}</span><span class="msg-tier">${ti.icon}</span>${hasSocks ? '<span class="msg-socks">🧦</span>' : ''}<br/><span class="msg-text">${escapeHtml(text)}</span>`;
      }
      msgContainer.appendChild(div);
      msgContainer.scrollTop = msgContainer.scrollHeight;
    }

    function escapeHtml(s) {
      return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    }

    const seenMessageKeys = new Set();
    function messageKey(msg) {
      return [msg.user || '', msg.text || '', msg.ts || ''].join('|');
    }
    function renderServerMessage(msg) {
      if (!msg || !msg.text) return;
      const key = messageKey(msg);
      if (seenMessageKeys.has(key)) return;
      seenMessageKeys.add(key);
      addMessage(msg.user || 'Guest', String(msg.text), msg.tier || 'free', !!msg.hasSocks);
    }
    async function syncMessages() {
      try {
        const response = await fetch('/api/chat', { cache: 'no-store' });
        if (!response.ok) return;
        const messages = await response.json();
        if (Array.isArray(messages)) messages.slice().reverse().forEach(renderServerMessage);
      } catch (_) {}
    }
    async function sendMessage() {
      const text = input.value.trim();
      if (!text) return;
      const username = localStorage.getItem('chatUsername') || ('User_' + Math.random().toString(36).substr(2,4));
      localStorage.setItem('chatUsername', username);
      const { tier, hasSocks } = getUserTier();
      input.value = '';
      sendBtn.disabled = true;
      try {
        const response = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ user: username, text, tier, hasSocks }),
        });
        const data = await response.json();
        if (response.ok && data.msg) renderServerMessage(data.msg);
        else addMessage(username, text, tier, hasSocks);
      } catch (_) {
        addMessage(username, text, tier, hasSocks);
      } finally {
        sendBtn.disabled = false;
        input.focus();
      }
    }
    sendBtn.addEventListener('click', sendMessage);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendMessage(); });

    // Randomised, clearly-labelled community prompts make each visit feel fresh.
    const welcomeMessages = [
      'Welcome to PVPN Community Chat! Be kind. 🧡',
      'Welcome in — your privacy settings stay active while you chat.',
      'Community chat is open. Never share passwords or payment details.',
      'Fresh session, fresh chat. Say hello 👋',
    ];
    const communityPrompts = [
      'PVPN Bot: Which browser are you using today?',
      'PVPN Bot: Tip — use the Home button to switch between featured sites.',
      'PVPN Bot: Free accounts stream at 480p; Premium unlocks higher quality.',
      'PVPN Bot: Remember to keep personal information out of public chat.',
      'PVPN Bot: The browser extension is optional when the built-in proxy works.',
      'PVPN Bot: What country should we add next?',
      'PVPN Bot: You can drag and resize this chat window.',
      'PVPN Bot: Found a loading problem? Mention the site and device.',
      'PVPN Bot: The orange theme wins every time. 🧡',
      'PVPN Bot: Use End Session when you are finished on a shared device.',
    ];
    function randomItem(items) { return items[Math.floor(Math.random() * items.length)]; }
    addMessage(null, randomItem(welcomeMessages), null, false, true);
    const firstPrompt = randomItem(communityPrompts);
    addMessage(null, firstPrompt, null, false, true);
    const remainingPrompts = communityPrompts.filter(p => p !== firstPrompt);
    setTimeout(() => addMessage(null, randomItem(remainingPrompts), null, false, true), 700 + Math.floor(Math.random() * 900));

    syncMessages();
    setInterval(syncMessages, 5000);
    return { addMessage, chat };    return { addMessage, chat };
  }

  // ─── INIT ───
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', createChat);
  } else {
    createChat();
  }

  window.PVPNChat = { createChat };
})();
