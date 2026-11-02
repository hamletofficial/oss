(function () {
  'use strict';

  if (window.__ibrHeaderProfileInitialized) return;
  window.__ibrHeaderProfileInitialized = true;

  var firestoreSdkPromise;
  var profileServicePromise;
  var profileUnsubscribers = [];
  var activeUid = null;
  var mailUnsubscribe = null;
  var mailNoticeDismissed = false;
  var mailNoticeElement = null;

  function ensureProfileService() {
    if (window.ibrProfileService) return Promise.resolve();
    if (profileServicePromise) return profileServicePromise;
    profileServicePromise = new Promise(function (resolve, reject) {
      var script = document.createElement('script');
      script.src = '/profile-service.js?v=20261010-2';
      script.async = true;
      script.onload = function () {
        if (window.ibrProfileService) resolve();
        else reject(new Error('Profile service did not initialise.'));
      };
      script.onerror = reject;
      document.head.appendChild(script);
    });
    return profileServicePromise;
  }

  function stopProfileListeners() {
    profileUnsubscribers.forEach(function (unsubscribe) {
      if (typeof unsubscribe === 'function') unsubscribe();
    });
    profileUnsubscribers = [];
  }

  function setFallbackPhoto(photoEl) {
    if (!photoEl) return;
    photoEl.onerror = null;
    photoEl.src = '/assets/images/dark-hamlet.png';
    photoEl.alt = 'Profile photo';
  }

  function ensureFirestoreCompat() {
    if (window.firebase && firebase.firestore) return Promise.resolve();
    if (firestoreSdkPromise) return firestoreSdkPromise;
    firestoreSdkPromise = new Promise(function (resolve, reject) {
      var existing = document.querySelector('script[data-ibr-firestore-compat]');
      if (existing) {
        existing.addEventListener('load', resolve, { once: true });
        existing.addEventListener('error', reject, { once: true });
        if (window.firebase && firebase.firestore) resolve();
        return;
      }
      var script = document.createElement('script');
      script.src = 'https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore-compat.js';
      script.async = true;
      script.dataset.ibrFirestoreCompat = 'true';
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
    return firestoreSdkPromise;
  }

  function stopMailListener() {
    if (typeof mailUnsubscribe === 'function') mailUnsubscribe();
    mailUnsubscribe = null;
    mailNoticeDismissed = false;
    if (mailNoticeElement) mailNoticeElement.remove();
    mailNoticeElement = null;
  }

  function ensureMailNotice() {
    if (mailNoticeElement && document.body.contains(mailNoticeElement)) return mailNoticeElement;
    if (!document.getElementById('ibr-mail-notice-styles')) {
      var style = document.createElement('style');
      style.id = 'ibr-mail-notice-styles';
      style.textContent = '#ibr-mail-notice{position:fixed;right:20px;bottom:20px;z-index:9999;width:min(360px,calc(100vw - 28px));padding:16px 16px 14px;border:1px solid #334155;border-radius:14px;background:#111827;color:#f9fafb;box-shadow:0 16px 42px rgba(0,0,0,.32);font:500 14px/1.45 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}#ibr-mail-notice[hidden]{display:none}#ibr-mail-notice .ibr-mail-notice-head{display:flex;align-items:flex-start;gap:10px}#ibr-mail-notice .ibr-mail-notice-icon{font-size:22px;line-height:1.2}#ibr-mail-notice .ibr-mail-notice-copy{flex:1;min-width:0}#ibr-mail-notice .ibr-mail-notice-title{font-weight:750;font-size:15px;margin:0 0 3px;color:#fff}#ibr-mail-notice .ibr-mail-notice-message{margin:0;color:#cbd5e1}#ibr-mail-notice .ibr-mail-notice-close{border:0;background:transparent;color:#cbd5e1;font-size:21px;line-height:1;cursor:pointer;padding:0 0 4px 6px}#ibr-mail-notice .ibr-mail-notice-actions{display:flex;justify-content:flex-end;margin-top:12px}#ibr-mail-notice .ibr-mail-notice-open{display:inline-flex;align-items:center;justify-content:center;padding:8px 12px;border-radius:8px;background:#1d4ed8;color:#fff;text-decoration:none;font-weight:700}#ibr-mail-notice .ibr-mail-notice-open:hover{background:#1e40af}#ibr-mail-notice .ibr-mail-notice-open:focus-visible,#ibr-mail-notice .ibr-mail-notice-close:focus-visible{outline:2px solid #93c5fd;outline-offset:3px}@media(max-width:480px){#ibr-mail-notice{right:10px;bottom:10px;width:calc(100vw - 20px)}}@media(prefers-reduced-motion:no-preference){#ibr-mail-notice:not([hidden]){animation:ibrMailNoticeIn .2s ease-out}@keyframes ibrMailNoticeIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}}';
      document.head.appendChild(style);
    }
    var notice = document.createElement('section');
    notice.id = 'ibr-mail-notice';
    notice.setAttribute('role', 'status');
    notice.setAttribute('aria-live', 'polite');
    notice.hidden = true;
    notice.innerHTML = '<div class="ibr-mail-notice-head"><span class="ibr-mail-notice-icon" aria-hidden="true">✉️</span><div class="ibr-mail-notice-copy"><p class="ibr-mail-notice-title">New mail in Hamlet</p><p class="ibr-mail-notice-message" id="ibr-mail-notice-message">You have unread messages.</p></div><button type="button" class="ibr-mail-notice-close" aria-label="Dismiss mail notification">&times;</button></div><div class="ibr-mail-notice-actions"><a class="ibr-mail-notice-open" href="/messages.html">Open Mailbox</a></div>';
    notice.querySelector('.ibr-mail-notice-close').addEventListener('click', function () {
      mailNoticeDismissed = true;
      notice.hidden = true;
    });
    document.body.appendChild(notice);
    mailNoticeElement = notice;
    return notice;
  }

  function startMailListener(user) {
    stopMailListener();
    if (!user || !window.firebase || !firebase.firestore) return;
    var knownMessageIds = new Set();
    var firstSnapshot = true;
    try {
      mailUnsubscribe = firebase.firestore().collection('directMessages')
        .where('participants', 'array-contains', user.uid)
        .onSnapshot(function (snapshot) {
          if (activeUid !== user.uid) return;
          var unreadCount = 0;
          var hasNewIncoming = false;
          snapshot.forEach(function (doc) {
            var message = doc.data() || {};
            knownMessageIds.add(doc.id);
            var isIncomingUnread = message.recipientUid === user.uid
              && message.senderUid !== user.uid
              && !(Array.isArray(message.readBy) && message.readBy.includes(user.uid));
            if (isIncomingUnread) {
              unreadCount += 1;
              if (!firstSnapshot && snapshot.docChanges().some(function (change) {
                return change.type === 'added' && change.doc.id === doc.id;
              })) hasNewIncoming = true;
            }
          });
          var notice = ensureMailNotice();
          if (hasNewIncoming) mailNoticeDismissed = false;
          if (unreadCount > 0 && (firstSnapshot || hasNewIncoming) && !mailNoticeDismissed) {
            var messageEl = notice.querySelector('#ibr-mail-notice-message');
            messageEl.textContent = hasNewIncoming
              ? 'You have received new mail. ' + unreadCount + ' unread ' + (unreadCount === 1 ? 'message' : 'messages') + '.'
              : 'You have ' + unreadCount + ' unread ' + (unreadCount === 1 ? 'message' : 'messages') + '.';
            notice.hidden = false;
          } else if (unreadCount === 0) {
            notice.hidden = true;
            mailNoticeDismissed = false;
          } else if (!mailNoticeDismissed && !notice.hidden) {
            var existingMessageEl = notice.querySelector('#ibr-mail-notice-message');
            existingMessageEl.textContent = 'You have ' + unreadCount + ' unread ' + (unreadCount === 1 ? 'message' : 'messages') + '.';
          }
          firstSnapshot = false;
        }, function (error) {
          console.warn('Unable to listen for incoming Hamlet messages:', error);
        });
    } catch (error) {
      console.warn('Unable to start incoming Hamlet message notifications:', error);
    }
  }


  // Shared 17-minute inactivity timeout. State survives refreshes and is shared across tabs.
  var inactivityState = { uid: null, timer: null, warning: null, lastWrite: 0 };
  var INACTIVITY_LIMIT_MS = 17 * 60 * 1000;
  var INACTIVITY_WARNING_MS = 16 * 60 * 1000;
  var INACTIVITY_STORAGE_KEY = null;
  var INACTIVITY_EVENTS = ['pointerdown', 'pointermove', 'mousemove', 'keydown', 'touchstart', 'wheel', 'scroll', 'click'];

  // Device-scoped session bootstrap. The server issues a custom Firebase token
  // containing a signed session ID; each browser profile has its own session.
  var deviceSessionBootstrap = false;
  var deviceActivityLastSent = 0;
  var DEVICE_SESSION_ID_KEY = 'hamlet:deviceSessionId';
  function getDeviceSessionId() {
    try {
      var id = localStorage.getItem(DEVICE_SESSION_ID_KEY);
      if (!id || !/^[A-Za-z0-9_-]{20,80}$/.test(id)) {
        var bytes = new Uint8Array(24);
        if (!window.crypto || !window.crypto.getRandomValues) throw new Error('Secure random generator unavailable.');
        window.crypto.getRandomValues(bytes);
        id = Array.from(bytes).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
        localStorage.setItem(DEVICE_SESSION_ID_KEY, id);
      }
      INACTIVITY_STORAGE_KEY = 'hamlet:lastActivityAt:' + id;
      return id;
    } catch (error) {
      console.error('Hamlet could not initialise a secure device session identifier:', error);
      return null;
    }
  }
  function callSessionFunction(name, data, user) {
    return user.getIdToken().then(function (token) {
      return fetch('https://us-central1-wale-491805.cloudfunctions.net/' + name, {
        method: 'POST',
        headers: {'Content-Type':'application/json', 'Authorization':'Bearer ' + token},
        body: JSON.stringify({data:data || {}})
      });
    }).then(function (response) {
      return response.json().then(function (payload) {
        if (!response.ok || payload.error) {
          var message = payload.error && payload.error.message ? payload.error.message : 'Session service request failed.';
          throw new Error(message);
        }
        return payload.result;
      });
    });
  }
  function bootstrapHamletDeviceSession(user) {
    if (!user || deviceSessionBootstrap || window.location.pathname.split('/').pop() === 'login.html') return;
    deviceSessionBootstrap = true;
    user.getIdTokenResult().then(function (tokenResult) {
      if (tokenResult.claims && tokenResult.claims.hamletSessionId) {
        return callSessionFunction('recordHamletDeviceActivity', {}, user).then(function () {
          deviceActivityLastSent = Date.now();
          window.dispatchEvent(new CustomEvent('hamlet:session-ready'));
          return null;
        });
      }
      var sessionId = getDeviceSessionId();
      if (!sessionId) throw new Error('A secure device session could not be created on this browser.');
      return callSessionFunction('createHamletDeviceSession', {
        deviceName: (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || 'Web browser',
        userAgent: navigator.userAgent || ''
      }, user).then(function (result) {
        if (!result || !result.customToken) throw new Error('The session service did not return a secure session token.');
        return firebase.auth().signInWithCustomToken(result.customToken);
      }).then(function () {
        deviceActivityLastSent = Date.now();
        window.dispatchEvent(new CustomEvent('hamlet:session-ready'));
        return null;
      });
    }).catch(function (error) {
      console.error('Hamlet device session could not be established:', error);
      if (user && firebase.auth().currentUser && firebase.auth().currentUser.uid === user.uid) {
        firebase.auth().signOut().finally(function () {
          window.location.replace('/login.html?reason=session-security');
        });
      }
    }).finally(function () {
      deviceSessionBootstrap = false;
    });
  }
  function heartbeatHamletDeviceSession(force) {
    var user = firebase.auth && firebase.auth().currentUser;
    if (!user) return;
    var now = Date.now();
    if (!force && now - deviceActivityLastSent < 60000) return;
    deviceActivityLastSent = now;
    callSessionFunction('recordHamletDeviceActivity', {}, user).catch(function (error) {
      console.warn('Hamlet could not renew this device session:', error);
      if (/expired|revoked|not registered/i.test(error.message || '')) {
        firebase.auth().signOut().finally(function () {
          window.location.replace('/login.html?reason=session-timeout');
        });
      }
    });
  }

  function readLastActivity() {
    try { if (!INACTIVITY_STORAGE_KEY) return 0; var value = Number(localStorage.getItem(INACTIVITY_STORAGE_KEY)); return Number.isFinite(value) && value > 0 ? value : 0; }
    catch (error) { return 0; }
  }
  function closeInactivityWarning() {
    if (inactivityState.warning) { inactivityState.warning.remove(); inactivityState.warning = null; }
  }
  function showInactivityWarning() {
    if (inactivityState.warning || !inactivityState.uid) return;
    var overlay = document.createElement('div');
    overlay.setAttribute('role', 'alertdialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'hamlet-inactivity-title');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483000;display:grid;place-items:center;padding:20px;background:rgba(2,6,23,.76);font:500 15px/1.5 system-ui,sans-serif;';
    var card = document.createElement('section');
    card.style.cssText = 'width:min(420px,100%);padding:24px;border:1px solid #334155;border-radius:16px;background:#111827;color:#f9fafb;box-shadow:0 24px 70px rgba(0,0,0,.45);';
    var title = document.createElement('h2'); title.id = 'hamlet-inactivity-title'; title.textContent = 'Still there?';
    title.style.cssText = 'margin:0 0 8px;font-size:1.2rem;color:#fff;';
    var copy = document.createElement('p'); copy.textContent = 'You will be signed out in 60 seconds due to inactivity. Continue working to keep your session active.';
    copy.style.cssText = 'margin:0 0 18px;color:#cbd5e1;';
    var button = document.createElement('button'); button.type = 'button'; button.textContent = 'Stay signed in';
    button.style.cssText = 'min-height:44px;padding:10px 16px;border:0;border-radius:8px;background:#1d4ed8;color:#fff;font:700 14px system-ui;cursor:pointer;';
    button.addEventListener('click', function () { recordInactivityActivity(true); });
    card.appendChild(title); card.appendChild(copy); card.appendChild(button); overlay.appendChild(card);
    document.body.appendChild(overlay); inactivityState.warning = overlay; button.focus();
  }
  function recordInactivityActivity(force) {
    if (!inactivityState.uid) return;
    var now = Date.now();
    if (!force && now - inactivityState.lastWrite < 1000) return;
    inactivityState.lastWrite = now;
    try { if (INACTIVITY_STORAGE_KEY) localStorage.setItem(INACTIVITY_STORAGE_KEY, String(now)); } catch (error) {}
    heartbeatHamletDeviceSession(false);
    closeInactivityWarning(); scheduleInactivityCheck();
  }
  function inactivityActivityHandler() { recordInactivityActivity(false); }
  function inactivityStorageHandler(event) {
    if (event.key === INACTIVITY_STORAGE_KEY && inactivityState.uid) { closeInactivityWarning(); scheduleInactivityCheck(); }
  }
  function stopInactivityMonitor() {
    if (inactivityState.timer) window.clearTimeout(inactivityState.timer);
    inactivityState.timer = null;
    INACTIVITY_EVENTS.forEach(function (name) { document.removeEventListener(name, inactivityActivityHandler, true); });
    window.removeEventListener('storage', inactivityStorageHandler);
    closeInactivityWarning(); inactivityState.uid = null;
  }
  function scheduleInactivityCheck() {
    if (!inactivityState.uid) return;
    if (inactivityState.timer) window.clearTimeout(inactivityState.timer);
    var last = readLastActivity();
    if (!last) { last = Date.now(); try { if (INACTIVITY_STORAGE_KEY) localStorage.setItem(INACTIVITY_STORAGE_KEY, String(last)); } catch (error) {} }
    var elapsed = Date.now() - last;
    if (elapsed >= INACTIVITY_LIMIT_MS) { expireInactiveSession(); return; }
    if (elapsed >= INACTIVITY_WARNING_MS) showInactivityWarning();
    var next = elapsed < INACTIVITY_WARNING_MS ? INACTIVITY_WARNING_MS - elapsed : INACTIVITY_LIMIT_MS - elapsed;
    inactivityState.timer = window.setTimeout(scheduleInactivityCheck, Math.max(250, Math.min(next, 15000)));
  }
  function expireInactiveSession() {
    if (!inactivityState.uid) return;
    var auth = window.firebase && firebase.auth ? firebase.auth() : null;
    stopInactivityMonitor();
    try { if (INACTIVITY_STORAGE_KEY) localStorage.removeItem(INACTIVITY_STORAGE_KEY); } catch (error) {}
    var destination = '/login.html?reason=session-timeout';
    if (auth) auth.signOut().catch(function (error) {
      console.warn('Hamlet inactivity sign-out encountered an error:', error);
    }).finally(function () { window.location.replace(destination); });
    else window.location.replace(destination);
  }
  function startInactivityMonitor(user) {
    stopInactivityMonitor();
    if (!user || window.location.pathname.split('/').pop() === 'login.html') return;
    inactivityState.uid = user.uid;
    if (!readLastActivity() && INACTIVITY_STORAGE_KEY) { try { localStorage.setItem(INACTIVITY_STORAGE_KEY, String(Date.now())); } catch (error) {} }
    INACTIVITY_EVENTS.forEach(function (name) { document.addEventListener(name, inactivityActivityHandler, true); });
    window.addEventListener('storage', inactivityStorageHandler);
    scheduleInactivityCheck();
  }

  function updateProfile(user) {
    stopProfileListeners();
    stopMailListener();
    activeUid = user ? user.uid : null;
    var chips = document.querySelectorAll('[data-auth-profile]');

    chips.forEach(function (chip) {
      var nameEl = chip.querySelector('[data-auth-name]');
      var photoEl = chip.querySelector('[data-auth-photo]');

      if (!user) {
        if (nameEl) nameEl.textContent = '';
        setFallbackPhoto(photoEl);
        chip.style.display = 'none';
        return;
      }

      // Do not flash a stale Firebase Auth displayName before the saved profile loads.
      if (nameEl) nameEl.textContent = 'Loading profile…';
      if (photoEl) {
        photoEl.referrerPolicy = 'no-referrer';
        photoEl.alt = 'Profile photo';
        photoEl.onerror = function () {
          photoEl.onerror = null;
          setFallbackPhoto(photoEl);
        };
        photoEl.src = '/assets/images/dark-hamlet.png';
      }
      chip.style.display = 'inline-flex';
    });

    if (!user) return;

    ensureFirestoreCompat().then(function () {
      if (activeUid === user.uid) startMailListener(user);
    }).catch(function (error) {
      console.warn('Unable to initialise incoming Hamlet message notifications:', error);
    });

    ensureFirestoreCompat().then(ensureProfileService).then(function () {
      if (activeUid !== user.uid || !window.firebase || !firebase.firestore || !window.ibrProfileService) return;
      var unsubscribe = window.ibrProfileService.watchProfile(user.uid, function (result) {
        if (activeUid !== user.uid) return;
        var data = result && result.data ? result.data : {};
        var savedName = data.displayName || user.displayName || user.email || 'Member';
        var savedPhoto = data.imageDataUrl
          || String(data.photoURL || data.photoUrl || data.photoURLData || user.photoURL || '').trim();

        document.querySelectorAll('[data-auth-profile]').forEach(function (chip) {
          var nameEl = chip.querySelector('[data-auth-name]');
          var photoEl = chip.querySelector('[data-auth-photo]');
          if (nameEl) nameEl.textContent = savedName;
          if (photoEl) {
            photoEl.alt = savedName + ' profile photo';
            photoEl.onerror = function () { photoEl.onerror = null; setFallbackPhoto(photoEl); };
            photoEl.src = savedPhoto || '/assets/images/dark-hamlet.png';
          }
        });
      }, function (error) {
        if (activeUid !== user.uid) return;
        console.warn('Unable to watch the signed-in member profile for the header:', error);
        document.querySelectorAll('[data-auth-profile]').forEach(function (chip) {
          var nameEl = chip.querySelector('[data-auth-name]');
          if (nameEl) nameEl.textContent = user.displayName || user.email || 'Member';
        });
      });
      profileUnsubscribers.push(unsubscribe);
    }).catch(function (error) {
      if (activeUid !== user.uid) return;
      console.warn('Unable to load the signed-in member profile for the header:', error);
      document.querySelectorAll('[data-auth-profile]').forEach(function (chip) {
        var nameEl = chip.querySelector('[data-auth-name]');
        if (nameEl) nameEl.textContent = user.displayName || user.email || 'Member';
      });
    });
  }

  function init() {
    if (!window.firebase || !window.firebase.auth || !window.firebaseConfig) {
      updateProfile(null);
      return;
    }

    try {
      if (!firebase.apps.length) firebase.initializeApp(window.firebaseConfig);
    } catch (error) {
      // Another page-level script may already have initialized Firebase.
    }

    try {
      firebase.auth().onAuthStateChanged(function (user) {
        if (user) { getDeviceSessionId(); bootstrapHamletDeviceSession(user); }
        else window.dispatchEvent(new CustomEvent('hamlet:session-signed-out'));
        startInactivityMonitor(user || null);
        updateProfile(user || null);
      });
    } catch (error) {
      updateProfile(null);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
