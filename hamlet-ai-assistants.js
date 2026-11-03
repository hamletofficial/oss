(function () {
  'use strict';

  var GATEWAY_URL = 'https://hamlet-ai-gateway-staging.alfred-mayaki.workers.dev/v1/assist';
  var path = window.location.pathname;
  var isPipeline = path.indexOf('/app/hamlet') === 0;
  var isLiveListings = path === '/app/public/live.html';
  if (!isPipeline && !isLiveListings) return;

  var task = isPipeline ? 'deal_copilot' : 'listing_assistant';
  var defaultPrompt = isPipeline
    ? 'Review the supplied deal notes. Summarise the current position, recommend the next three practical actions, identify missing information and dependencies, and flag potential critical-path risks. Separate facts from assumptions.'
    : 'Draft polished, accurate commercial property listing copy from the supplied facts. Provide a headline, concise overview, key features and a call to action. Mark material missing details as questions or placeholders rather than guessing.';
  var contextLabel = isPipeline ? 'Deal notes and milestones' : 'Property facts and listing notes';
  var contextPlaceholder = isPipeline
    ? 'Add relevant deal facts, stage, next milestones, deadlines, dependencies and notes. Include only information you are authorised to share.'
    : 'Add property type, location, floor area, availability, asking terms, description and verified sustainability credentials. Include only facts you can substantiate.';
  var panel = null;
  var form = null;
  var messageInput = null;
  var contextInput = null;
  var submitButton = null;
  var statusNode = null;
  var output = null;
  var outputText = null;
  var modelNode = null;
  var auth = null;

  function onReady(callback) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', callback, { once: true });
    } else {
      callback();
    }
  }

  function addStyles() {
    if (document.getElementById('hamletAiAssistantStyles')) return;
    var style = document.createElement('style');
    style.id = 'hamletAiAssistantStyles';
    style.textContent =
      '.hamlet-ai-assistant{box-sizing:border-box;width:100%;margin:18px 0 24px;padding:22px;border:1px solid;border-radius:16px;box-shadow:0 10px 28px rgba(2,6,23,.08);font-family:inherit}' +
      '.hamlet-ai-assistant *{box-sizing:border-box}.hamlet-ai-assistant[data-variant="pipeline"]{background:linear-gradient(135deg,#142944,#101a2b 78%);border-color:#304967;color:#edf3fc}' +
      '.hamlet-ai-assistant[data-variant="listing"]{background:rgba(255,255,255,.96);border-color:#cbd5e1;color:#0f172a}' +
      '.hamlet-ai-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;margin-bottom:16px}' +
      '.hamlet-ai-eyebrow{margin:0 0 6px;color:#0f9b83;font-size:10px;font-weight:800;letter-spacing:1.5px;text-transform:uppercase}' +
      '.hamlet-ai-assistant[data-variant="pipeline"] .hamlet-ai-eyebrow{color:#64ddc0}' +
      '.hamlet-ai-title{margin:0 0 6px;font-size:clamp(18px,2vw,23px);font-weight:800;line-height:1.25}' +
      '.hamlet-ai-desc{margin:0;max-width:780px;font-size:13px;line-height:1.55;color:#52647a}' +
      '.hamlet-ai-assistant[data-variant="pipeline"] .hamlet-ai-desc{color:#aebed4}' +
      '.hamlet-ai-pill{flex:0 0 auto;padding:6px 9px;border:1px solid #b6cde5;border-radius:999px;background:#eff6ff;color:#194a80;font-size:10px;font-weight:800;white-space:nowrap}' +
      '.hamlet-ai-assistant[data-variant="pipeline"] .hamlet-ai-pill{border-color:#365982;background:#1c3554;color:#cfe3ff}' +
      '.hamlet-ai-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}' +
      '.hamlet-ai-field{display:flex;flex-direction:column;gap:7px;min-width:0}' +
      '.hamlet-ai-field label{font-size:12px;font-weight:800;color:#173b5d}' +
      '.hamlet-ai-assistant[data-variant="pipeline"] .hamlet-ai-field label{color:#dbeafe}' +
      '.hamlet-ai-field textarea{width:100%;min-height:118px;resize:vertical;padding:11px 12px;border:1px solid #cbd5e1;border-radius:10px;background:#fff;color:#0f172a;font:inherit;font-size:13px;line-height:1.5;outline:none}' +
      '.hamlet-ai-assistant[data-variant="pipeline"] .hamlet-ai-field textarea{background:#0b1120;border-color:#354b68;color:#edf3fc;caret-color:#93c5fd}' +
      '.hamlet-ai-assistant[data-variant="pipeline"] .hamlet-ai-field textarea:focus{border-color:#68a6ff;box-shadow:0 0 0 3px rgba(104,166,255,.18)}' +
      '.hamlet-ai-assistant[data-variant="pipeline"] .hamlet-ai-field textarea::placeholder{color:#8195b2;opacity:1}' +
      '.hamlet-ai-field textarea:focus{border-color:#0284c7;box-shadow:0 0 0 3px rgba(2,132,199,.14)}' +
      '.hamlet-ai-field textarea::placeholder{color:#64748b}' +
      '.hamlet-ai-actions{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-top:14px}' +
      '.hamlet-ai-submit{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:40px;padding:10px 15px;border:1px solid #0c4a6e;border-radius:9px;background:#075985;color:#fff;font-size:12px;font-weight:800;cursor:pointer}' +
      '.hamlet-ai-assistant[data-variant="pipeline"] .hamlet-ai-submit{border-color:#68a6ff;background:#68a6ff;color:#07162c}' +
      '.hamlet-ai-submit:hover{filter:brightness(1.06)}.hamlet-ai-submit:disabled{opacity:.6;cursor:wait}' +
      '.hamlet-ai-status{margin:0;color:#52647a;font-size:12px;line-height:1.5}' +
      '.hamlet-ai-assistant[data-variant="pipeline"] .hamlet-ai-status{color:#aebed4}' +
      '.hamlet-ai-status[data-kind="error"]{color:#b91c1c}.hamlet-ai-assistant[data-variant="pipeline"] .hamlet-ai-status[data-kind="error"]{color:#fecaca}' +
      '.hamlet-ai-output{margin-top:17px;padding:15px;border:1px solid #cbd5e1;border-radius:11px;background:#f8fafc;color:#0f172a}' +
      '.hamlet-ai-assistant[data-variant="pipeline"] .hamlet-ai-output{border-color:#354b68;background:#0b1525;color:#edf3fc}' +
      '.hamlet-ai-output[hidden]{display:none!important}.hamlet-ai-output-head{display:flex;justify-content:space-between;gap:10px;align-items:center;margin-bottom:10px}' +
      '.hamlet-ai-output h3{margin:0;font-size:13px;font-weight:800}.hamlet-ai-output-model{font-size:10px;color:#64748b}' +
      '.hamlet-ai-assistant[data-variant="pipeline"] .hamlet-ai-output-model{color:#91a2bb}' +
      '.hamlet-ai-output-text{margin:0;white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px;line-height:1.65;font-family:inherit}' +
      '.hamlet-ai-privacy{margin:12px 0 0;color:#64748b;font-size:10px;line-height:1.5}' +
      '.hamlet-ai-assistant[data-variant="pipeline"] .hamlet-ai-privacy{color:#8195b2}' +
      '.hamlet-ai-context-button{min-height:30px;padding:6px 9px;border:1px solid #0284c7!important;border-radius:7px;background:#eff6ff!important;color:#075985!important;font-size:10px!important;font-weight:800;line-height:1.2;cursor:pointer;white-space:nowrap}' +
      '.hamlet-ai-assistant[data-variant="pipeline"] ~ * .hamlet-ai-context-button{font-size:10px}' +
      '.deal-card-actions .hamlet-ai-context-button{padding:5px 7px;font-size:10px}' +
      '.deal-list-row .hamlet-ai-context-button{align-self:center}' +
      '@media(max-width:720px){.hamlet-ai-assistant{padding:16px}.hamlet-ai-head{flex-direction:column}.hamlet-ai-fields{grid-template-columns:1fr}.hamlet-ai-field textarea{min-height:100px}.hamlet-ai-actions{align-items:flex-start;flex-direction:column}.hamlet-ai-submit{width:100%}.hamlet-ai-context-button{white-space:normal}}';
    document.head.appendChild(style);
  }

  function createPanel() {
    var section = document.createElement('section');
    section.className = 'hamlet-ai-assistant';
    section.id = 'hamletAiAssistant';
    section.dataset.variant = isPipeline ? 'pipeline' : 'listing';
    section.setAttribute('aria-labelledby', 'hamletAiTitle');
    section.innerHTML =
      '<div class="hamlet-ai-head"><div><p class="hamlet-ai-eyebrow">' + (isPipeline ? 'Deal intelligence' : 'Listing studio') + '</p>' +
      '<h2 class="hamlet-ai-title" id="hamletAiTitle">' + (isPipeline ? 'AI Deal Copilot' : 'AI Listing Assistant') + '</h2>' +
      '<p class="hamlet-ai-desc">' + (isPipeline
        ? 'Turn the deal notes you provide into practical next steps, dependencies and critical-path questions.'
        : 'Draft listing copy from verified property facts. Use the “Draft with AI” action on a property card to load its visible details below.') + '</p></div>' +
      '<span class="hamlet-ai-pill">Preview · human-reviewed</span></div>' +
      '<form id="hamletAiForm">' +
      '<div class="hamlet-ai-fields"><div class="hamlet-ai-field"><label for="hamletAiMessage">Your instruction</label>' +
      '<textarea id="hamletAiMessage" maxlength="4000" required></textarea></div>' +
      '<div class="hamlet-ai-field"><label for="hamletAiContext">' + contextLabel + ' (optional)</label>' +
      '<textarea id="hamletAiContext" maxlength="8000" placeholder="' + contextPlaceholder + '"></textarea></div></div>' +
      '<div class="hamlet-ai-actions"><button class="hamlet-ai-submit" id="hamletAiSubmit" type="submit">' + (isPipeline ? 'Ask Deal Copilot' : 'Draft listing copy') + '</button>' +
      '<p class="hamlet-ai-status" id="hamletAiStatus" role="status" aria-live="polite">Checking secure sign-in…</p></div></form>' +
      '<section class="hamlet-ai-output" id="hamletAiOutput" aria-labelledby="hamletAiOutputTitle" aria-live="polite" hidden>' +
      '<div class="hamlet-ai-output-head"><h3 id="hamletAiOutputTitle">Assistant response</h3><span class="hamlet-ai-output-model" id="hamletAiModel"></span></div>' +
      '<p class="hamlet-ai-output-text" id="hamletAiOutputText"></p></section>' +
      '<p class="hamlet-ai-privacy">Only submit information you are authorised to share. Your request is sent to the Hamlet AI gateway and is not saved to your Hamlet deal or property records. Review all output before using it; the assistant does not alter records or publish listings.</p>';
    return section;
  }

  function setStatus(message, kind) {
    if (!statusNode) return;
    statusNode.textContent = message || '';
    statusNode.dataset.kind = kind || '';
  }

  function buildContextFromDeal(card) {
    var clone = card.cloneNode(true);
    clone.querySelectorAll('button, select, input, textarea, .hamlet-ai-context-button').forEach(function (element) {
      element.remove();
    });
    return clone.innerText.trim().slice(0, 8000);
  }

  function buildContextFromListing(card) {
    var title = card.querySelector('h3');
    var badge = card.querySelector('.badge');
    var meta = card.querySelector('.property-meta');
    var details = Array.from(card.querySelectorAll('.property-description'))
      .map(function (element) { return element.innerText.trim(); })
      .filter(function (value) { return value && !/^Broker contact\s*:/i.test(value); });
    return [
      title ? 'Property: ' + title.textContent.trim() : '',
      badge ? 'Status: ' + badge.textContent.trim() : '',
      meta ? meta.innerText.trim() : '',
      details.join('\n')
    ].filter(Boolean).join('\n\n').slice(0, 8000);
  }

  function decorateDealCards() {
    document.querySelectorAll('#board .deal-card, #board .deal-list-row').forEach(function (card) {
      if (card.querySelector('.hamlet-ai-context-button')) return;
      var editButton = card.querySelector('[data-edit-deal]');
      if (!editButton) return;
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'hamlet-ai-context-button';
      button.textContent = 'Ask Copilot';
      button.dataset.hamletAiSource = 'deal';
      button.setAttribute('aria-label', 'Ask Deal Copilot about ' + ((card.querySelector('h3') || {}).textContent || 'this deal').trim());
      editButton.insertAdjacentElement('afterend', button);
    });
  }

  function decorateListingCards() {
    document.querySelectorAll('#listingList .property-card').forEach(function (card) {
      if (card.querySelector('.hamlet-ai-context-button')) return;
      var actions = card.querySelector('.card-actions');
      if (!actions) return;
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'hamlet-ai-context-button';
      button.textContent = 'Draft with AI';
      button.dataset.hamletAiSource = 'listing';
      button.setAttribute('aria-label', 'Draft listing copy for ' + ((card.querySelector('h3') || {}).textContent || 'this property').trim());
      actions.insertBefore(button, actions.firstChild);
    });
  }

  function observeCards() {
    var board = document.getElementById('board');
    if (board) {
      decorateDealCards();
      new MutationObserver(decorateDealCards).observe(board, { childList: true, subtree: true });
    }
    var listingList = document.getElementById('listingList');
    if (listingList) {
      decorateListingCards();
      new MutationObserver(decorateListingCards).observe(listingList, { childList: true, subtree: true });
    }
  }

  function setContextFromCard(button) {
    var card = button.closest(button.dataset.hamletAiSource === 'deal'
      ? '.deal-card, .deal-list-row'
      : '.property-card');
    if (!card || !contextInput) return;
    contextInput.value = button.dataset.hamletAiSource === 'deal'
      ? buildContextFromDeal(card)
      : buildContextFromListing(card);
    setStatus('Visible card details loaded. Add your instruction or use the suggestion in the prompt field.', '');
    output.hidden = true;
    panel.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
    contextInput.focus({ preventScroll: true });
  }

  function friendlyError(status, payload) {
    if (status === 401) return 'Hamlet could not verify your sign-in token. Sign out and sign in again, then retry.';
    if (status === 403) return (payload && payload.error === 'Origin not allowed.')
      ? 'This page origin is not allowed by the gateway. Open Hamlet at https://www.hamlet-ai.co.uk and retry.'
      : 'The gateway refused this request. Check the Worker access configuration.';
    if (status === 503) return 'The AI service is not configured in Cloudflare. Check the Worker secret settings.';
    if (status === 502) return 'The gateway could not complete the AI request. Check the Worker tail for the upstream status; the key, model access, quota or request may need attention.';
    if (payload && typeof payload.error === 'string') return payload.error;
    return 'The assistant request failed (HTTP ' + status + '). Please retry and check the Worker logs if it continues.';
  }

  async function submitAssistant(event) {
    event.preventDefault();
    if (!form.reportValidity()) return;
    var currentUser = auth && auth.currentUser;
    if (!currentUser) {
      setStatus('Sign in to Hamlet before using the assistant.', 'error');
      return;
    }
    var message = messageInput.value.trim();
    var context = contextInput.value.trim();
    if (!message) {
      setStatus('Enter an instruction before submitting.', 'error');
      messageInput.focus();
      return;
    }
    submitButton.disabled = true;
    submitButton.textContent = 'Working…';
    setStatus('Sending your request securely…', '');
    output.hidden = true;
    try {
      var token = await currentUser.getIdToken();
      var response = await fetch(GATEWAY_URL, {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + token,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ task: task, message: message, context: context })
      });
      var payload = null;
      try {
        payload = await response.json();
      } catch (parseError) {
        payload = null;
      }
      if (!response.ok) {
        setStatus(friendlyError(response.status, payload), 'error');
        return;
      }
      if (!payload || typeof payload.reply !== 'string' || !payload.reply.trim()) {
        setStatus('The gateway returned an empty or unreadable response. Check the Worker logs.', 'error');
        return;
      }
      outputText.textContent = payload.reply.trim();
      modelNode.textContent = payload.model ? 'Model: ' + payload.model : '';
      output.hidden = false;
      setStatus('Response ready. Review it before using it in a transaction or listing.', '');
    } catch (error) {
      console.error('Hamlet AI assistant request failed:', error);
      setStatus('Could not reach the AI gateway. Check your connection, the allowed site origin and the Wrangler tail logs.', 'error');
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = isPipeline ? 'Ask Deal Copilot' : 'Draft listing copy';
    }
  }

  function init() {
    var anchor = document.querySelector(isPipeline ? 'main .hero' : '#resourceShell .hero');
    if (!anchor || document.getElementById('hamletAiAssistant')) return;
    addStyles();
    panel = createPanel();
    anchor.insertAdjacentElement('afterend', panel);
    form = document.getElementById('hamletAiForm');
    messageInput = document.getElementById('hamletAiMessage');
    contextInput = document.getElementById('hamletAiContext');
    submitButton = document.getElementById('hamletAiSubmit');
    statusNode = document.getElementById('hamletAiStatus');
    output = document.getElementById('hamletAiOutput');
    outputText = document.getElementById('hamletAiOutputText');
    modelNode = document.getElementById('hamletAiModel');
    messageInput.placeholder = defaultPrompt;
    form.addEventListener('submit', submitAssistant);
    document.addEventListener('click', function (event) {
      var button = event.target.closest('.hamlet-ai-context-button');
      if (!button) return;
      event.preventDefault();
      setContextFromCard(button);
    });
    observeCards();
    try {
      if (!window.firebase || !window.firebaseConfig) throw new Error('Firebase configuration is unavailable.');
      if (!firebase.apps.length) firebase.initializeApp(window.firebaseConfig);
      auth = firebase.auth();
      auth.onAuthStateChanged(function (user) {
        submitButton.disabled = !user;
        setStatus(user ? 'Signed in. Add a prompt or load details from a card.' : 'Sign in to Hamlet to use this assistant.', user ? '' : 'error');
      }, function () {
        submitButton.disabled = true;
        setStatus('Could not verify your secure sign-in. Reload Hamlet and try again.', 'error');
      });
    } catch (error) {
      submitButton.disabled = true;
      setStatus('Firebase sign-in could not be initialised. Reload the page and sign in again.', 'error');
      console.error('Hamlet AI assistant could not initialise Firebase:', error);
    }
  }

  onReady(init);
})();