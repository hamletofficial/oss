(function () {
  'use strict';

  function setViewportHeightVar() {
    var vh = window.innerHeight * 0.01;
    document.documentElement.style.setProperty('--app-vh', vh + 'px');
  }

  var rafId = 0;
  function scheduleViewportUpdate() {
    if (rafId) window.cancelAnimationFrame(rafId);
    rafId = window.requestAnimationFrame(setViewportHeightVar);
  }

  document.addEventListener('DOMContentLoaded', setViewportHeightVar);
  window.addEventListener('resize', scheduleViewportUpdate, { passive: true });
  window.addEventListener('orientationchange', scheduleViewportUpdate, { passive: true });
  window.addEventListener('pageshow', scheduleViewportUpdate, { passive: true });
})();
