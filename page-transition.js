(function () {
  'use strict';

  const PROTECTED_PATHS = new Set([
    '/index.html',
    '/members.html',
    '/members.html',
    '/messages.html',
    '/insights.html',
    '/requests.html',
    '/settings.html',
    '/directory.html',
    '/invoice.html',
    '/contact.html',
    '/compose.html',
    '/accounts.html',
    '/profile.html',
    '/app/public/live.html',
    '/app/public/resources.html',
    '/app/public/dashboard.html'
  ]);

  const PAGE_LABELS = {
    '/index.html': 'Members Area',
    '/members.html': 'Members Area',
    '/messages.html': 'Messages Inbox',
    '/insights.html': 'Insights Archive',
    '/requests.html': 'Media Relations',
    '/settings.html': 'Account Settings',
    '/directory.html': 'Member Directory',
    '/invoice.html': 'Payments',
    '/contact.html': 'Contact Sales',
    '/compose.html': 'Compose Message',
    '/accounts.html': 'Accounts Admin',
    '/profile.html': 'Profile Page',
    '/app/public/live.html': 'Live Listings',
    '/app/public/resources.html': 'My Property Resources',
    '/app/public/dashboard.html': 'Advertise a New Property'
  };

  const PREFETCH_PATHS = ['/messages.html', '/insights.html', '/requests.html', '/settings.html', '/directory.html', '/invoice.html', '/contact.html', '/uploads.html', '/accounts.html', '/profile.html', '/app/public/live.html', '/app/public/resources.html', '/app/public/dashboard.html'];
  const MIN_LOADER_MS = 240;
  let overlayEl = null;
  let prefetchDone = false;
  let navigating = false;

  function isSameOrigin(url) {
    try {
      return url.origin === window.location.origin;
    } catch (e) {
      return false;
    }
  }

  function canonicalPath(pathname) {
    return normalizePath(pathname);
  }

  function normalizePath(pathname) {
    if (!pathname || pathname === '/') return '/index.html';
    return pathname;
  }

  function isProtectedPath(pathname) {
    return PROTECTED_PATHS.has(normalizePath(pathname));
  }

  function ensureActiveMenuStyles() {
    if (document.getElementById('active-menu-style')) return;
    const style = document.createElement('style');
    style.id = 'active-menu-style';
    style.textContent = '.sidebar-menu-link.is-current{background:#092a4b!important;color:#ffffff!important;transform:translateX(3px)}';
    document.head.appendChild(style);
  }

  function highlightCurrentSidebarLink() {
    ensureActiveMenuStyles();
    const currentPath = canonicalPath(window.location.pathname);
    const menuLinks = document.querySelectorAll('.sidebar-menu-shell .sidebar-menu-link[href]');

    menuLinks.forEach(function (link) {
      link.classList.remove('is-current');
      link.removeAttribute('aria-current');

      let linkUrl;
      try {
        linkUrl = new URL(link.getAttribute('href'), window.location.origin);
      } catch (e) {
        return;
      }

      if (!isSameOrigin(linkUrl)) return;
      if (canonicalPath(linkUrl.pathname) !== currentPath) return;

      link.classList.add('is-current');
      link.setAttribute('aria-current', 'page');
    });
  }

  function isAuthenticatedUiVisible() {
    const signOutBtn = document.getElementById('signOutBtn');
    const signOutVisible = !!(signOutBtn && signOutBtn.offsetParent !== null && getComputedStyle(signOutBtn).display !== 'none');

    const topNavMenu = document.getElementById('topNavMenu');
    const topNavVisible = !!(topNavMenu && topNavMenu.offsetParent !== null && getComputedStyle(topNavMenu).display !== 'none');

    const loginSection = document.getElementById('login-section');
    const protectedContent = document.getElementById('protected-content') || document.getElementById('dashboard');
    const loggedInShellVisible = !!(protectedContent && protectedContent.offsetParent !== null) && !(loginSection && loginSection.offsetParent !== null);

    return signOutVisible || topNavVisible || loggedInShellVisible;
  }

  function ensureOverlay() {
    if (overlayEl) return overlayEl;
    overlayEl = document.querySelector('.page-transition-overlay');
    if (overlayEl) return overlayEl;

    overlayEl = document.createElement('div');
    overlayEl.className = 'page-transition-overlay';
    overlayEl.setAttribute('aria-hidden', 'true');
    overlayEl.innerHTML = '<div class="page-transition-card" role="status" aria-live="polite"><span class="page-transition-spinner" aria-hidden="true"></span><span class="page-transition-label">Opening secure page…</span></div>';
    document.body.appendChild(overlayEl);
    return overlayEl;
  }

  function setOverlayLabel(text) {
    const node = ensureOverlay();
    const label = node.querySelector('.page-transition-label');
    if (!label) return;
    label.textContent = text || 'Opening secure page…';
  }

  function showOverlay() {
    const node = ensureOverlay();
    document.body.classList.add('page-transition-leaving');
    node.classList.add('active');
  }

  function hideOverlay() {
    if (!overlayEl) return;
    document.body.classList.remove('page-transition-leaving');
    overlayEl.classList.remove('active');
    setOverlayLabel('Opening secure page…');
  }

  function canHandleAnchor(anchor, event) {
    if (!anchor || navigating) return false;
    if (event.defaultPrevented) return false;
    if (event.button !== 0) return false;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
    if (anchor.target && anchor.target !== '_self') return false;
    if (anchor.hasAttribute('download')) return false;

    const href = anchor.getAttribute('href') || '';
    if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:')) return false;
    // Prevent overlay for login page navigation
    if (href === '/login.html' || href.endsWith('/login.html')) return false;

    let targetUrl;
    try {
      targetUrl = new URL(anchor.href, window.location.href);
    } catch (e) {
      return false;
    }

    if (!isSameOrigin(targetUrl)) return false;
    if (!isProtectedPath(targetUrl.pathname)) return false;

    const currentPath = normalizePath(window.location.pathname);
    const targetPath = normalizePath(targetUrl.pathname);
    if (currentPath === targetPath && targetUrl.hash === window.location.hash) return false;

    return targetUrl;
  }

  function getDestinationLabel(anchor, targetUrl) {
    const pathLabel = PAGE_LABELS[normalizePath(targetUrl.pathname)];
    if (pathLabel) return 'Opening ' + pathLabel + '…';

    const anchorText = (anchor && anchor.textContent ? anchor.textContent : '').trim();
    if (anchorText) return 'Opening ' + anchorText + '…';

    return 'Opening secure page…';
  }

  function prefetchProtectedPages() {
    if (prefetchDone || !isAuthenticatedUiVisible()) return;
    prefetchDone = true;

    PREFETCH_PATHS.forEach(function (path) {
      if (normalizePath(window.location.pathname) === path) return;
      if (document.querySelector('link[rel="prefetch"][href="' + path + '"]')) return;
      const link = document.createElement('link');
      link.rel = 'prefetch';
      link.href = path;
      link.as = 'document';
      document.head.appendChild(link);
    });
  }

  function handleClick(event) {
    const anchor = event.target && event.target.closest ? event.target.closest('a[href]') : null;
    const targetUrl = canHandleAnchor(anchor, event);
    if (!targetUrl || !isAuthenticatedUiVisible()) return;

    event.preventDefault();
    navigating = true;
    setOverlayLabel(getDestinationLabel(anchor, targetUrl));
    showOverlay();

    const start = Date.now();
    const navigate = function () {
      const elapsed = Date.now() - start;
      const delay = Math.max(0, MIN_LOADER_MS - elapsed);
      window.setTimeout(function () {
        window.location.assign(targetUrl.href);
      }, delay);
    };

    if (typeof document.startViewTransition === 'function' && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      try {
        document.startViewTransition(function () { });
      } catch (e) { }
    }

    navigate();
  }

  function consumeAuthArrival() {
    var pending = '';
    try { pending = sessionStorage.getItem('ibr_auth_transition') || ''; } catch (e) { return; }
    if (!pending) return;

    setOverlayLabel('Opening Members Area…');
    showOverlay();
    var started = Date.now();

    function settle() {
      var wait = Math.max(0, 520 - (Date.now() - started));
      window.setTimeout(function () {
        try { sessionStorage.removeItem('ibr_auth_transition'); } catch (e) {}
        document.documentElement.classList.remove('auth-arriving');
        hideOverlay();
      }, wait);
    }

    var tries = 0;
    function tick() {
      tries += 1;
      var pendingAuth = document.body.classList.contains('auth-pending');
      if (!pendingAuth || tries > 40) settle();
      else window.setTimeout(tick, 50);
    }
    tick();
  }

  function schedulePrefetchRetries() {
    for (let i = 1; i <= 6; i += 1) {
      window.setTimeout(prefetchProtectedPages, i * 700);
      window.setTimeout(highlightCurrentSidebarLink, i * 700);
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    ensureOverlay();
    consumeAuthArrival();
    document.addEventListener('click', handleClick, true);
    prefetchProtectedPages();
    highlightCurrentSidebarLink();
    schedulePrefetchRetries();
  });

  window.addEventListener('pageshow', function () {
    var arriving = false;
    try { arriving = !!sessionStorage.getItem('ibr_auth_transition'); } catch (e) {}
    navigating = false;
    if (!arriving) hideOverlay();
    else consumeAuthArrival();
    highlightCurrentSidebarLink();
  });
})();
