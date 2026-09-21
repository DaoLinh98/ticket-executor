// The service worker exists for exactly one reason: on iOS a push message is
// delivered to a worker, never to a page. The app is suspended the moment it
// leaves the foreground, so there is no page to deliver to — this file is the
// only code of ours that runs while the phone is locked.
//
// It caches nothing and intercepts no requests on purpose. An offline cache
// would be a second source of truth for an app whose every screen is a live
// read of a provider, and a stale shell is worse than no shell.

// Take over without waiting for every open copy of the app to close, so
// enabling notifications works on the first tap rather than the next launch.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    // A push with an unreadable body is still a push. iOS revokes the
    // subscription of a web app that receives one and shows nothing, so a
    // generic banner is the safe answer, not silence.
  }

  const title = payload.title || "D-Agent";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: payload.body || "",
      // Both are required for the banner to carry the app's mark; iOS ignores
      // `image` and uses the badge for the small monochrome glyph.
      icon: "/icons/icon-192.png",
      badge: "/icons/badge-72.png",
      // Same tag replaces an earlier banner about the same thing instead of
      // stacking a second one.
      tag: payload.tag || "ticket-executor",
      data: { url: payload.url || "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";

  // Focus the installed app if it is already running and navigate it, rather
  // than opening a second copy — on iOS a home-screen app has exactly one
  // window, and openWindow() there would push the user into Safari.
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client) {
          if ("navigate" in client) client.navigate(url).catch(() => {});
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
