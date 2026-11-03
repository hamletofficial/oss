/* Hamlet web-push service worker. Keep this file at the site root for scope /. */
importScripts("https://www.gstatic.com/firebasejs/9.22.2/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/9.22.2/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyChWtcZbStdG0ep7FdL8OG6ESgSXtzDZ1k",
  authDomain: "wale-491805.firebaseapp.com",
  projectId: "wale-491805",
  storageBucket: "wale-491805.firebasestorage.app",
  messagingSenderId: "753131375199",
  appId: "1:753131375199:web:87d3eef7edda42d640a9ea"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage(function(payload) {
  const notification = payload.notification || {};
  const data = payload.data || {};
  const title = notification.title || "New message on Hamlet";
  const options = {
    body: notification.body || "You have received a new direct message.",
    icon: "/assets/images/favicon.ico",
    badge: "/assets/images/favicon.ico",
    tag: data.messageId ? "hamlet-direct-message-" + data.messageId : "hamlet-direct-message",
    data: { url: data.url || "/messages.html" },
    renotify: true
  };
  return self.registration.showNotification(title, options);
});

self.addEventListener("notificationclick", function(event) {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || "/messages.html", self.location.origin).href;
  event.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then(function(clientList) {
    for (const client of clientList) {
      if (client.url.startsWith(self.location.origin) && "focus" in client) {
        if ("navigate" in client) client.navigate(target);
        return client.focus();
      }
    }
    return clients.openWindow(target);
  }));
});
