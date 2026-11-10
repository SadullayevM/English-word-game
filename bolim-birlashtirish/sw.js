// =============================================================
// sw.js — Service worker: ilovani internetsiz (offline) ishlatadi.
// Ilova fayllarini telefon xotirasiga (kesh) saqlab qo'yadi.
// MUHIM: ilova kodini o'zgartirganingizda CACHE_VERSION raqamini
// bittaga oshiring (masalan v1 -> v2), shunda eski kesh tozalanadi.
// =============================================================

const CACHE_VERSION = 'v4';
const CACHE_NAME = `soz-yodlash-${CACHE_VERSION}`;

// Offline ishlashi uchun oldindan saqlanadigan fayllar ro'yxati
const APP_FILES = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/app.js',
  './js/storage.js',
  './js/quiz.js',
  './js/ui.js',
  './js/ai.js',
  './js/config.js',
  './js/cloud.js',
  './js/sync.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png'
];

// O'rnatish: barcha ilova fayllarini keshga yozib qo'yadi
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_FILES))
      .then(() => self.skipWaiting())
  );
});

// Faollashish: eski versiyadagi keshlarni o'chiradi
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(
        names
          .filter((name) => name.startsWith('soz-yodlash-') && name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      ))
      .then(() => self.clients.claim())
  );
});

// So'rovlar: avval keshdan beradi (tez va offline ishlaydi),
// orqa fonda esa internetdan yangi nusxani olib keshni yangilaydi.
self.addEventListener('fetch', (event) => {
  const request = event.request;

  // Faqat o'z saytimizdagi GET so'rovlarni boshqaramiz
  if (request.method !== 'GET') return;
  if (new URL(request.url).origin !== self.location.origin) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request, { ignoreSearch: true });

    // Internetdan yangi nusxani olib, keshga yozish
    const networkFetch = fetch(request)
      .then((response) => {
        if (response && response.ok) {
          cache.put(request, response.clone());
        }
        return response;
      })
      .catch(() => null);

    if (cached) {
      // Keshdagini darhol qaytaramiz, yangilanish orqa fonda davom etadi
      event.waitUntil(networkFetch);
      return cached;
    }

    const fresh = await networkFetch;
    if (fresh) return fresh;

    // Internet yo'q va keshda ham yo'q: sahifa so'ralgan bo'lsa, bosh sahifani beramiz
    if (request.mode === 'navigate') {
      const fallback = await cache.match('./index.html');
      if (fallback) return fallback;
    }
    return new Response('Internet aloqasi yo\'q', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
  })());
});
