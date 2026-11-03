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
