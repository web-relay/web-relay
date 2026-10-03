const CACHE = 'web-relay-demo-v1';
const SHELL = ['/', '/main.js', '/manifest.webmanifest', '/icon.svg'];
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
});
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith('web-relay-demo-') && key !== CACHE).map((key) => caches.delete(key)))));
});
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  event.respondWith(fetch(event.request).catch(async () => {
    const match = await caches.match(event.request);
    if (match) return match;
    if (event.request.mode === 'navigate') return (await caches.match('/')) || Response.error();
    return Response.error();
  }));
});
