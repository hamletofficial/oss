/* App-scoped implementation of the root page-loading effect.
   Applies to navigation within /app/public/ and /app/hamlet/ only. */
(function () {
  'use strict';
  var overlay = null;
  var navigating = false;
  var MIN_LOADER_MS = 240;

  function inAppArea(path) {
    return path.indexOf('/app/public/') === 0 || path.indexOf('/app/hamlet/') === 0;
  }

  function ensureOverlay() {
    if (overlay && overlay.isConnected) return overlay;
    overlay = document.querySelector('.app-page-transition-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.className = 'app-page-transition-overlay';
      overlay.setAttribute('aria-hidden', 'true');
      overlay.innerHTML = '<div class="app-page-transition-card" role="status" aria-live="polite"><span class="app-page-transition-spinner" aria-hidden="true"></span><span class="app-page-transition-label">Opening secure page…</span></div>';
      document.body.appendChild(overlay);
    }
    return overlay;
  }

  function isSameOrigin(url) {
    try { return url.origin === window.location.origin; } catch (e) { return false; }
  }

  function handleClick(event) {
    if (navigating || event.defaultPrevented || event.button !== 0 ||
        event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    var anchor = event.target && event.target.closest ? event.target.closest('a[href]') : null;
    if (!anchor || (anchor.target && anchor.target !== '_self') || anchor.hasAttribute('download')) return;
    var href = anchor.getAttribute('href') || '';
    if (!href || href.charAt(0) === '#' || /^(mailto:|tel:|javascript:)/i.test(href)) return;
    var target;
    try { target = new URL(anchor.href, window.location.href); } catch (e) { return; }
    if (!isSameOrigin(target) || !inAppArea(target.pathname) || target.href === window.location.href) return;

    event.preventDefault();
    navigating = true;
    var node = ensureOverlay();
    var label = node.querySelector('.app-page-transition-label');
    if (label) {
      var text = (anchor.textContent || '').trim();
      label.textContent = text ? 'Opening ' + text + '…' : 'Opening secure page…';
    }
    document.body.classList.add('app-page-transition-leaving');
    node.classList.add('active');
    var started = Date.now();
    window.setTimeout(function () {
      window.location.assign(target.href);
    }, Math.max(0, MIN_LOADER_MS - (Date.now() - started)));
  }

  function init() {
    ensureOverlay();
    document.addEventListener('click', handleClick, true);
    window.addEventListener('pageshow', function () {
      navigating = false;
      if (overlay) overlay.classList.remove('active');
      document.body.classList.remove('app-page-transition-leaving');
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();