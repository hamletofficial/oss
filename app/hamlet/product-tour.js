/* Hamlet member onboarding tour. Runs only after Firebase confirms an authenticated user. */
(function () {
  'use strict';
  var TOUR_KEY = 'hamlet-product-tour-v1:';
  var userUid = null;
  var stepIndex = 0;
  var overlay = null;
  var steps = [
    { title: 'Welcome to Hamlet', body: 'Your commercial property workspace brings deal tracking, critical dates, property records and member collaboration together. This short tour introduces the main areas; it will not change or create any data.', target: '.hero', action: null },
    { title: 'Your deal pipeline', body: 'Create opportunities, move transactions through their stages, record counterparties and notes, and use the board or list view to see progress. Start with “Add a deal”.', target: '#board', action: { label: 'Add a deal', selector: '#addDealBtn' } },
    { title: 'Critical dates and reminders', body: 'Add deadlines linked to transactions, review what is due or overdue, and configure optional browser alerts. Keep the next action visible before it becomes urgent.', target: '#reminderList', action: { label: 'Add a deadline', selector: '#addReminderBtn' } },
    { title: 'Find properties and records', body: 'Live Properties lets you browse available property opportunities. My Properties is where you manage your own property records. Link a relevant property to a deal where appropriate.', target: '.workspace-nav', action: { label: 'Browse live properties', href: '/app/public/live.html' } },
    { title: 'Contacts, messages and social updates', body: 'Use Contacts & Directory to discover member profiles, Messages for direct conversations, and Social Feed for short updates and discussion.', target: '.workspace-nav', action: { label: 'Open directory', href: '/directory.html' } },
    { title: 'Transaction intelligence & records', body: 'Further down the dashboard, review deal history, manage transaction documents, save reusable searches, explore deal intelligence and calculate indicative yields, price per square foot and broker fees. Calculations are indicative, not professional valuation or tax advice.', target: '#hamletAdvancedTools', action: null },
    { title: 'You are ready to begin', body: 'Use workspace search to find deals, properties, messages and public member profiles. You can revisit this tour at any time using “Product tour” in the dashboard header.', target: '.workspace-search', action: null }
  ];

  function completedKey() { return TOUR_KEY + userUid; }
  function isCompleted() {
    try { return localStorage.getItem(completedKey()) === 'complete' || localStorage.getItem(completedKey()) === 'skipped'; }
    catch (_) { return false; }
  }
  function markComplete(status) {
    try { localStorage.setItem(completedKey(), status); } catch (_) {}
    closeTour();
  }
  function el(tag, attrs, text) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (key) { node.setAttribute(key, attrs[key]); });
    if (text != null) node.textContent = text;
    return node;
  }
  function ensureStyles() {
    if (document.getElementById('hamletTourStyles')) return;
    var style = el('style', { id: 'hamletTourStyles' });
    style.textContent = '#hamletTourOverlay{position:fixed;inset:0;z-index:100050;background:rgba(3,8,18,.78);display:flex;align-items:center;justify-content:center;padding:18px;font-family:"DM Sans",sans-serif}#hamletTourOverlay[hidden]{display:none!important}.hamlet-tour-card{width:min(520px,100%);max-height:min(88vh,680px);overflow:auto;background:#111d30;color:#edf3fc;border:1px solid #456184;border-radius:18px;padding:24px;box-shadow:0 25px 90px #0009}.hamlet-tour-top{display:flex;align-items:center;justify-content:space-between;gap:12px;color:#8fbaff;font-size:11px;font-weight:800;letter-spacing:1px;text-transform:uppercase}.hamlet-tour-card h2{font:800 23px Manrope,"DM Sans",sans-serif;letter-spacing:-.5px;margin:18px 0 10px}.hamlet-tour-card p{font-size:14px;line-height:1.7;color:#b9c8dc;margin:0}.hamlet-tour-progress{height:5px;background:#273950;border-radius:99px;overflow:hidden;margin:20px 0}.hamlet-tour-progress span{display:block;height:100%;background:#68a6ff;transition:width .2s}.hamlet-tour-actions{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap}.hamlet-tour-actions div{display:flex;gap:8px;flex-wrap:wrap}.hamlet-tour-btn{border:1px solid #405775;border-radius:9px;padding:10px 13px;background:#182840;color:#edf3fc;font-weight:700;font-size:12px;cursor:pointer}.hamlet-tour-btn.primary{background:#6aa5ff;border-color:#6aa5ff;color:#07162c}.hamlet-tour-btn:focus-visible{outline:2px solid #b9d5ff;outline-offset:3px}.hamlet-tour-target{outline:3px solid #78adff!important;outline-offset:4px!important;border-radius:8px!important;scroll-margin:100px}@media(max-width:520px){.hamlet-tour-card{padding:20px}.hamlet-tour-card h2{font-size:21px}.hamlet-tour-actions{align-items:stretch}.hamlet-tour-actions>div{width:100%}.hamlet-tour-actions .hamlet-tour-btn{flex:1}.hamlet-tour-actions>.hamlet-tour-btn{order:2}}@media(prefers-reduced-motion:reduce){.hamlet-tour-progress span{transition:none}}';
    document.head.appendChild(style);
  }
  function getOverlay() {
    if (overlay) return overlay;
    ensureStyles();
    overlay = el('div', { id: 'hamletTourOverlay', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'hamletTourTitle', hidden: '' });
    var card = el('section', { 'class': 'hamlet-tour-card' });
    var top = el('div', { 'class': 'hamlet-tour-top' });
    top.appendChild(el('span', {}, 'Hamlet product tour'));
    var stepLabel = el('span', { id: 'hamletTourStep' }, '');
    top.appendChild(stepLabel);
    var title = el('h2', { id: 'hamletTourTitle' }, '');
    var body = el('p', { id: 'hamletTourBody' }, '');
    var progress = el('div', { 'class': 'hamlet-tour-progress', 'aria-hidden': 'true' });
    var bar = el('span', { id: 'hamletTourProgress' });
    progress.appendChild(bar);
    var actions = el('div', { 'class': 'hamlet-tour-actions' });
    var skip = el('button', { type: 'button', 'class': 'hamlet-tour-btn' }, 'Skip tour');
    skip.addEventListener('click', function () { markComplete('skipped'); });
    var group = el('div');
    var back = el('button', { type: 'button', 'class': 'hamlet-tour-btn', id: 'hamletTourBack' }, 'Back');
    var next = el('button', { type: 'button', 'class': 'hamlet-tour-btn primary', id: 'hamletTourNext' }, 'Next');
    back.addEventListener('click', function () { if (stepIndex > 0) { stepIndex--; renderStep(); } });
    next.addEventListener('click', function () { if (stepIndex < steps.length - 1) { stepIndex++; renderStep(); } else { markComplete('complete'); } });
    group.appendChild(back); group.appendChild(next);
    actions.appendChild(skip); actions.appendChild(group);
    card.appendChild(top); card.appendChild(title); card.appendChild(body); card.appendChild(progress); card.appendChild(actions);
    overlay.appendChild(card); document.body.appendChild(overlay);
    overlay.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') { event.preventDefault(); markComplete('skipped'); }
      if (event.key === 'ArrowRight' && stepIndex < steps.length - 1) { stepIndex++; renderStep(); }
      if (event.key === 'ArrowLeft' && stepIndex > 0) { stepIndex--; renderStep(); }
    });
    return overlay;
  }
  function clearTarget() {
    document.querySelectorAll('.hamlet-tour-target').forEach(function (node) { node.classList.remove('hamlet-tour-target'); });
  }
  function renderStep() {
    var root = getOverlay(), step = steps[stepIndex];
    clearTarget();
    root.querySelector('#hamletTourStep').textContent = (stepIndex + 1) + ' of ' + steps.length;
    root.querySelector('#hamletTourTitle').textContent = step.title;
    root.querySelector('#hamletTourBody').textContent = step.body;
    root.querySelector('#hamletTourProgress').style.width = ((stepIndex + 1) / steps.length * 100) + '%';
    root.querySelector('#hamletTourBack').disabled = stepIndex === 0;
    root.querySelector('#hamletTourNext').textContent = stepIndex === steps.length - 1 ? 'Finish tour' : 'Next';
    var oldAction = root.querySelector('#hamletTourOptionalAction');
    if (oldAction) oldAction.remove();
    if (step.action) {
      var action = el('button', { type: 'button', id: 'hamletTourOptionalAction', 'class': 'hamlet-tour-btn' }, step.action.label);
      action.addEventListener('click', function () {
        if (step.action.selector) {
          var target = document.querySelector(step.action.selector);
          if (target) { markComplete('complete'); target.click(); }
        } else if (step.action.href) {
          markComplete('complete');
          window.location.href = step.action.href;
        }
      });
      root.querySelector('.hamlet-tour-actions > div').insertBefore(action, root.querySelector('#hamletTourNext'));
    }
    root.hidden = false;
    if (step.target) {
      var target = document.querySelector(step.target);
      if (target) { target.classList.add('hamlet-tour-target'); if (stepIndex > 0) target.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'nearest' }); }
    }
    root.querySelector('#hamletTourNext').focus();
  }
  function openTour() { stepIndex = 0; renderStep(); }
  function closeTour() { clearTarget(); if (overlay) overlay.hidden = true; }
  function addLaunchButton() {
    if (document.getElementById('hamletProductTourButton')) return;
    var actions = document.querySelector('.hero-actions');
    if (!actions) return;
    var button = el('button', { id: 'hamletProductTourButton', type: 'button', 'class': 'btn', 'aria-label': 'Open Hamlet product tour' }, '◎ Product tour');
    button.addEventListener('click', openTour);
    actions.insertBefore(button, actions.firstChild);
  }
  function init() {
    if (!window.firebase || !window.firebaseConfig) return;
    try {
      if (!firebase.apps.length) firebase.initializeApp(window.firebaseConfig);
      firebase.auth().onAuthStateChanged(function (user) {
        if (!user) {
          userUid = null;
          closeTour();
          var button = document.getElementById('hamletProductTourButton');
          if (button) button.remove();
          return;
        }
        userUid = user.uid;
        addLaunchButton();
        if (!isCompleted()) openTour();
      }, function (error) { console.warn('Hamlet tour waits for confirmed sign-in:', error); });
    } catch (error) { console.warn('Hamlet tour could not initialise:', error); }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();