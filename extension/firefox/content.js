// PVPN companion handshake.
// A DOM marker is used because extension content scripts run in an isolated world.
(function () {
  const VERSION = '1.1.1';
  function announce() {
    if (!document.documentElement) return;
    document.documentElement.setAttribute('data-pvpn-extension', 'ready');
    document.documentElement.setAttribute('data-pvpn-extension-version', VERSION);
    window.dispatchEvent(new CustomEvent('pvpn-extension-ready', {
      detail: { version: VERSION }
    }));
  }
  announce();
  if (!document.documentElement) {
    new MutationObserver(function (_, observer) {
      if (document.documentElement) {
        announce();
        observer.disconnect();
      }
    }).observe(document, { childList: true, subtree: true });
  }
})();
