// Service Worker - note-ocr
const CACHE_NAME = 'note-ocr-v2';

self.addEventListener('install', (event) => {
  console.log('Service Worker Registered');
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  console.log('Service Worker Activated');
  event.waitUntil(clients.claim());
});

// Passthrough fetch for now — add caching strategy here later
self.addEventListener('fetch', (event) => {
  event.respondWith(fetch(event.request));
});
