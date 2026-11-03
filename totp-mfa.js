import { initializeApp, getApps } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import QRCode from 'https://cdn.jsdelivr.net/npm/qrcode@1.5.4/+esm';
import {
  getAuth,
  multiFactor,
  TotpMultiFactorGenerator,
  getMultiFactorResolver,
  GoogleAuthProvider,
  FacebookAuthProvider,
  TwitterAuthProvider,
  OAuthProvider,
  reauthenticateWithPopup
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';

window.ibrTotp = window.ibrTotp || {};

// Defer initialization until the classic firebase-config.js script has run.
// A module can execute before deferred classic scripts on some page/load paths.
window.ibrTotp.ready = new Promise((resolve, reject) => {
  let started = false;
  function init() {
    if (started) return;
    if (!window.firebaseConfig) return;
    started = true;
    try {
      const apps = getApps();
      const app = apps.length ? apps[0] : initializeApp(window.firebaseConfig);
      const auth = getAuth(app);
      const api = {
        app, auth, multiFactor, TotpMultiFactorGenerator, getMultiFactorResolver, QRCode,
        GoogleAuthProvider, FacebookAuthProvider, TwitterAuthProvider,
        OAuthProvider, reauthenticateWithPopup
      };
      window.ibrTotp.api = api;
      resolve(api);
    } catch (error) {
      console.error('Unable to initialize the 2FA security module:', error);
      reject(error);
    }
  }

  // Run immediately if configuration is already available, otherwise wait
  // for the config script and retry on both DOM readiness and full page load.
  init();
  if (!started) {
    document.addEventListener('DOMContentLoaded', init, { once: true });
    window.addEventListener('load', init, { once: true });
  }
  // A final short-lived retry handles pages where the config script is injected
  // asynchronously after the document events have already fired.
  if (!started) {
    let attempts = 0;
    const retry = window.setInterval(() => {
      init();
      attempts += 1;
      if (started || attempts >= 40) {
        window.clearInterval(retry);
        if (!started) reject(new Error('Firebase configuration did not become available.'));
      }
    }, 100);
  }
});
