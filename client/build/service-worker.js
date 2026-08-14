const CACHE_NAME = 'pb-app-shell-v5';
const APP_SHELL_URLS = [
  '/',
  '/index.html',
  '/icon-192.png',
  '/icon-512.png',
  '/manifest.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL_URLS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  if (event.request.method !== 'GET') return;

  if (
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/uploads/') ||
    url.pathname.startsWith('/outputs/') ||
    url.pathname.startsWith('/contact-docs/')
  ) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok && url.origin === self.location.origin) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request).then((cached) => cached || caches.match('/')))
  );
});

self.addEventListener('sync', (event) => {
  if (event.tag === 'pb-photo-sync') {
    event.waitUntil(syncPendingPhotos());
  }
});

async function syncPendingPhotos() {
  const DB_NAME = 'pb_photo_queue';
  const STORE_NAME = 'pending_photos';

  const db = await new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains(STORE_NAME)) {
        d.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  const items = await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });

  for (const item of items) {
    try {
      const blob = new Blob([item.blob], { type: item.mimeType });
      const formData = new FormData();
      formData.append('photo', blob, item.fileName);
      if (item.caption) formData.append('caption', item.caption);

      const res = await fetch(`/api/jobs/${item.jobId}/photos`, {
        method: 'POST',
        headers: { 'x-auth-token': item.token },
        body: formData
      });

      if (res.ok) {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).delete(item.id);
        await new Promise((resolve) => { tx.oncomplete = resolve; });
      }
    } catch (e) {
      console.log('SW sync: upload failed for item', item.id, e);
    }
  }

  const clients = await self.clients.matchAll();
  for (const client of clients) {
    client.postMessage({ type: 'PHOTOS_SYNCED' });
  }
}
