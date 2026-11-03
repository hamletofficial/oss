/* Hamlet is dark-only. Include /theme.css and this script in every new HTML page's
   <head> to apply the shared dark palette before the page is displayed. */
(function () {
  "use strict";

  function applyDarkTheme() {
    document.documentElement.setAttribute("data-appearance", "dark");
    document.documentElement.style.colorScheme = "dark";
  }

  /* Apply immediately to avoid a light-theme flash on first paint. */
  applyDarkTheme();

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", applyDarkTheme, { once: true });
  }

  /* Prevent page scripts from switching the site back to a light appearance. */
  if (typeof MutationObserver === "function") {
    var observer = new MutationObserver(function () {
      if (document.documentElement.getAttribute("data-appearance") !== "dark") {
        applyDarkTheme();
      }
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-appearance"]
    });
  }

  /* Backwards-compatible API: callers may request a theme, but dark is enforced. */
  window.IBRAppearance = {
    set: function () { applyDarkTheme(); },
    get: function () { return "dark"; }
  };
})();

  // Brand consistency: apply the contrasting full-stop to wordmarks across all pages, including the homepage.
  function applyHamletWordmarkDot() {
    document.querySelectorAll('a.brand, a.sector-brand, a.search-brand, .brand-wordmark, a.legal-brand, a.pricing-brand, a.site-title').forEach(el => {
      const firstText = el.childNodes[0]?.textContent?.trim() || '';
      if (!/^hamlet$/i.test(firstText) && !/^hamlet(?:\s|\.|$)/i.test(el.textContent.trim())) return;

      // Reuse a full stop already present in the markup; mark it so CSS/other
      // scripts do not add another one.
      const existingDot = Array.from(el.querySelectorAll('span')).find(span => span.textContent.trim() === '.');
      if (existingDot) {
        existingDot.classList.add('brand-dot');
        return;
      }
      if (el.querySelector('.brand-dot')) return;

      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        if (/hamlet/i.test(node.nodeValue)) {
          const dot = document.createElement('span');
          dot.className = 'brand-dot';
          dot.textContent = '.';
          dot.style.color = '#bfdbfe';
          node.parentNode.insertBefore(dot, node.nextSibling);
          break;
        }
      }
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', applyHamletWordmarkDot, { once: true });
  else applyHamletWordmarkDot();
