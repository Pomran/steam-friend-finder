self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', function (event) {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) {}

  const title = data.title || 'Steam 车队通知';
  const options = {
    body: data.body || '你的车队有新动静！',
    icon: '/icons/icon128.png',
    badge: '/icons/icon48.png',
    data: { url: data.url || '/play' },
  };

  event.waitUntil(
    (async () => {
      try {
        await self.registration.showNotification(title, options);
        const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        for (const client of clients) client.postMessage({ type: 'push-shown', title, body: options.body });
      } catch (err) {
        console.error('showNotification failed:', err);
        try {
          await self.registration.showNotification(title, { body: options.body, data: options.data });
        } catch (err2) {
          console.error('fallback showNotification failed:', err2);
        }
        const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        for (const client of clients) client.postMessage({ type: 'push-error', error: String(err) });
      }
    })()
  );
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/play';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
      for (const client of list) {
        if ('focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
