self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// No-op fetch handler: satisfies PWA installability without caching,
// so label checks and repairs always run against fresh server data.
self.addEventListener("fetch", () => {});
