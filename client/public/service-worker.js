// Self-unregistering service worker — clears all stale caches then removes itself.
// This replaces the old caching SW that was causing stale-bundle crashes.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
      .then(() => self.clients.matchAll({ includeUncontrolled: true }))
      .then((clients) => {
        clients.forEach((c) => c.navigate(c.url));
        return self.registration.unregister();
      })
  );
});
