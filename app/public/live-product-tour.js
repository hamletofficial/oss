/* Hamlet Live Listings product tour. Authenticated first-visit guide with replay support. */
(function () {
  'use strict';
  var KEY_PREFIX = 'hamlet-live-tour-v1:';
  var uid = null, index = 0, backdrop = null, card = null, activeTarget = null, previousFocus = null;
  var steps = [
    { title: 'Welcome to Live Listings', body: 'Explore commercial property opportunities shared by authenticated Hamlet members. This tour explains the tools without changing your records.', target: '.hero' },
    { title: 'Search the property market', body: 'Search property names, locations, sizes and descriptions. Multiple search terms work together to narrow the results.', target: '#listingSearch' },
    { title: 'Refine and sort results', body: 'Filter by property type, availability and listing status, then sort by newest, property name, location or type.', target: '.listing-filters' },
    { title: 'Save properties and searches', body: 'Save individual properties on this device, view saved properties only, and save named search-and-filter combinations for later.', target: '.listing-tools-actions' },
    { title: 'Explore property cards', body: 'Cards summarise each property. Where details are provided, you can open an external listing, contact the broker, or send the opportunity to your Hamlet Deal Pipeline.', target: '#listingList' },
    { title: 'Export your filtered view', body: 'Export filtered CSV downloads only the listings currently visible after search and filters. Clear filters restores the full view.', target: '#exportListingsBtn' },
    { title: 'Broker reviews and ratings', body: 'Read community feedback and the average rating. Members can submit a review of up to 3,000 characters and select a one-to-five-star rating.', target: '#reviewPanel' },
    { title: 'Identity, policy and support', body: 'Check your member identity and Entrust status. Use listing policy for guidance, manage your resources, advertise a property, or report suspected fraud.', target: '.hero-actions' }
  ];
  function el(tag, attrs, text) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (key) { node.setAttribute(key, attrs[key]); });
    if (text != null) node.textContent = text;
    return node;
  }
  function completed() {
    try { var value = localStorage.getItem(KEY_PREFIX + uid); return value === 'done' || value === 'skipped'; }
    catch (e) { return false; }
  }
  function remember(value) { try { localStorage.setItem(KEY_PREFIX + uid, value); } catch (e) {} }
  function clearHighlight() {
    if (activeTarget) {
      activeTarget.classList.remove('hamlet-live-tour-target');
      activeTarget.removeAttribute('data-hamlet-tour-target');
    }
    activeTarget = null;
  }
  function close() {
    clearHighlight();
    if (backdrop) backdrop.hidden = true;
    
    if (previousFocus && document.contains(previousFocus)) {
      try { previousFocus.focus({ preventScroll: true }); } catch (e) { previousFocus.focus(); }
    }
    previousFocus = null;
  }
  function finish(status) { remember(status); close(); }
  function placeCard(target) {
    if (!card) return;
  }
  function highlight(selector) {
    clearHighlight();
    var target = selector && document.querySelector(selector);
    if (!target || target.hidden) {
      card.querySelector('.hamlet-live-tour-body').textContent = steps[index].body + ' You can continue the tour; this section may not be available until the page finishes loading.';
      placeCard(null);
      return;
    }
    activeTarget = target;
    target.classList.add('hamlet-live-tour-target');
    target.setAttribute('data-hamlet-tour-target', 'true');
    try {
      target.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center', inline: 'nearest' });
    } catch (e) {}
    placeCard(target);
  }
  function render() {
    var step = steps[index];
    card.querySelector('.hamlet-live-tour-count').textContent = 'STEP ' + (index + 1) + ' OF ' + steps.length;
    card.querySelector('.hamlet-live-tour-title').textContent = step.title;
    card.querySelector('.hamlet-live-tour-body').textContent = step.body;
    card.querySelector('.hamlet-live-tour-progress').style.width = (((index + 1) / steps.length) * 100) + '%';
    card.querySelector('.hamlet-live-tour-back').disabled = index === 0;
    card.querySelector('.hamlet-live-tour-next').textContent = index === steps.length - 1 ? 'Finish tour' : 'Next';
    highlight(step.target);
  }
  function move(delta) {
    if (index + delta < 0) return;
    if (index + delta >= steps.length) { finish('done'); return; }
    index += delta;
    render();
  }
  function build() {
    if (backdrop) return;
    var style = el('style', { id: 'hamletLiveTourStyles' });
    style.textContent = '#hamletLiveTourBackdrop{position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;padding:18px;background:rgba(3,12,29,.78);backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px);font-family:Arial,sans-serif}#hamletLiveTourBackdrop[hidden]{display:none!important}#hamletLiveTourCard{position:relative;z-index:1;width:min(520px,100%);max-height:min(88vh,680px);overflow:auto;border:1px solid #365982;border-radius:18px;background:linear-gradient(145deg,#fff,#f3f8ff);color:#092a4b;box-shadow:0 26px 80px #02081799;font-family:"Open Sans",Arial,sans-serif}.hamlet-live-tour-top{padding:22px 24px 0}.hamlet-live-tour-eyebrow{font-size:10px;font-weight:800;letter-spacing:.14em;color:#0369a1}.hamlet-live-tour-title{margin:8px 0 10px;font-size:22px;line-height:1.25;color:#071d4a}.hamlet-live-tour-body{padding:0 24px 20px;margin:0;color:#334155;font-size:14px;line-height:1.7}.hamlet-live-tour-progress-track{height:4px;background:#dbeafe}.hamlet-live-tour-progress{height:100%;width:0;background:linear-gradient(90deg,#0284c7,#1d4ed8);transition:width .2s ease}.hamlet-live-tour-controls{display:flex;align-items:center;gap:8px;padding:14px 20px 18px;border-top:1px solid #dbe3ee}.hamlet-live-tour-controls button{border:1px solid #cbd5e1;border-radius:9px;padding:9px 12px;background:#fff;color:#173b5d;font:700 12px "Open Sans",Arial,sans-serif;cursor:pointer}.hamlet-live-tour-controls .hamlet-live-tour-next{margin-left:auto;background:#0754a6;color:#fff;border-color:#0754a6}.hamlet-live-tour-controls button:disabled{opacity:.4;cursor:default}.hamlet-live-tour-skip{border:0!important;background:transparent!important;color:#64748b!important}.hamlet-live-tour-target{outline:3px solid #38bdf8!important;outline-offset:4px!important;box-shadow:0 0 0 7px rgba(2,132,199,.2)!important;border-radius:10px!important;scroll-margin:24px!important}.hamlet-live-tour-launch{background:#e0f2fe!important;color:#073b70!important;border-color:#7dd3fc!important}.hamlet-live-tour-launch:focus-visible,.hamlet-live-tour-controls button:focus-visible{outline:3px solid #0284c7;outline-offset:3px}@media(max-width:520px){#hamletLiveTourBackdrop{padding:12px}#hamletLiveTourCard{width:100%;border-radius:16px;max-height:88vh}.hamlet-live-tour-top{padding:18px 18px 0}.hamlet-live-tour-title{font-size:20px}.hamlet-live-tour-body{padding:0 18px 16px;font-size:13px}.hamlet-live-tour-controls{padding:12px;gap:6px}.hamlet-live-tour-controls button{padding:9px 10px;font-size:11px}}@media(prefers-reduced-motion:reduce){.hamlet-live-tour-progress{transition:none}}';
    document.head.appendChild(style);
    backdrop = el('div', { id: 'hamletLiveTourBackdrop', hidden: 'hidden', 'aria-hidden': 'true' });
    card = el('section', { id: 'hamletLiveTourCard', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'hamletLiveTourTitle', 'aria-describedby': 'hamletLiveTourBody' });
    var top = el('div', { 'class': 'hamlet-live-tour-top' });
    top.appendChild(el('div', { 'class': 'hamlet-live-tour-eyebrow hamlet-live-tour-count' }, 'STEP 1 OF ' + steps.length));
    top.appendChild(el('h2', { id: 'hamletLiveTourTitle', 'class': 'hamlet-live-tour-title' }, 'Welcome to Live Listings'));
    var body = el('p', { id: 'hamletLiveTourBody', 'class': 'hamlet-live-tour-body' }, '');
    var track = el('div', { 'class': 'hamlet-live-tour-progress-track', 'aria-hidden': 'true' });
    track.appendChild(el('div', { 'class': 'hamlet-live-tour-progress' }));
    var controls = el('div', { 'class': 'hamlet-live-tour-controls' });
    var skip = el('button', { type: 'button', 'class': 'hamlet-live-tour-skip' }, 'Skip tour');
    var back = el('button', { type: 'button', 'class': 'hamlet-live-tour-back' }, 'Back');
    var next = el('button', { type: 'button', 'class': 'hamlet-live-tour-next' }, 'Next');
    skip.addEventListener('click', function () { finish('skipped'); });
    back.addEventListener('click', function () { move(-1); });
    next.addEventListener('click', function () { move(1); });
    controls.append(skip, back, next);
    card.append(top, body, track, controls);
    backdrop.appendChild(card);
    document.body.appendChild(backdrop);
    document.addEventListener('keydown', function (event) {
      if (!card || !backdrop || backdrop.hidden) return;
      if (event.key === 'Escape') { event.preventDefault(); finish('skipped'); }
      else if (event.key === 'ArrowRight') { event.preventDefault(); move(1); }
      else if (event.key === 'ArrowLeft') { event.preventDefault(); move(-1); }
      else if (event.key === 'Tab') {
        var focusables = Array.from(card.querySelectorAll('button:not(:disabled)'));
        if (!focusables.length) return;
        var first = focusables[0], last = focusables[focusables.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    });
    window.addEventListener('resize', function () { if (card && backdrop && !backdrop.hidden) placeCard(activeTarget); });
  }
  function open() {
    if (!uid) return;
    build();
    previousFocus = document.activeElement;
    index = 0;
    backdrop.hidden = false;
    render();
    var next = card.querySelector('.hamlet-live-tour-next');
    if (next) next.focus();
  }
  function addButton() {
    var actions = document.querySelector('.hero-actions');
    if (!actions || document.getElementById('hamletLiveTourButton')) return;
    var button = el('button', { id: 'hamletLiveTourButton', type: 'button', 'class': 'btn hamlet-live-tour-launch', 'aria-label': 'Replay Live Listings product tour' }, '◎ Product tour');
    button.addEventListener('click', open);
    actions.insertBefore(button, actions.firstChild);
  }
  function init() {
    if (!window.firebase || !window.firebaseConfig) return;
    try {
      if (!firebase.apps.length) firebase.initializeApp(window.firebaseConfig);
      firebase.auth().onAuthStateChanged(function (user) {
        if (!user) {
          uid = null; close();
          var button = document.getElementById('hamletLiveTourButton');
          if (button) button.remove();
          return;
        }
        uid = user.uid;
        addButton();
        if (!completed()) open();
      }, function (error) { console.warn('Live Listings tour could not confirm sign-in:', error); });
    } catch (error) { console.warn('Live Listings tour could not initialise:', error); }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();