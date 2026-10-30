/* Dum & Dee service worker: Web Push only (no offline caching). */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let d = {};
  try {
    d = event.data ? event.data.json() : {};
  } catch (e) {
    d = {};
  }
  const title = typeof d.title === 'string' ? d.title : 'Dum & Dee';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: typeof d.body === 'string' ? d.body : '',
      tag: typeof d.tag === 'string' ? d.tag : 'dd',
      icon: '/icon-192-v2.png',
      badge: '/favicon-32-v2.png',
      data: { url: typeof d.url === 'string' && d.url.startsWith('/') ? d.url : '/' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ('focus' in c) return c.focus();
      }
      return self.clients.openWindow(url);
    }),
  );
});
