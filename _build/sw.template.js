// Service worker for The Chore Chart.
//
// BUILD is stamped in by build.py on every build, so this file's bytes change
// with every deploy. That is what makes a browser notice a new version at
// all. (This file used to never change, and the cache was cache-first, so a
// device kept serving its first-ever copy of the page until site data was
// cleared by hand.)
const BUILD = "__BUILD_ID__";
const CACHE_NAME = "chore-chart-" + BUILD;

// Pinned library versions never change at their URLs, so they can be served
// straight from cache.
const LIBS = [
  "https://www.gstatic.com/firebasejs/10.13.0/firebase-app-compat.js",
  "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore-compat.js",
  "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth-compat.js",
  "https://www.gstatic.com/firebasejs/10.13.0/firebase-functions-compat.js",
  "https://unpkg.com/react@18/umd/react.production.min.js",
  "https://unpkg.com/react-dom@18/umd/react-dom.production.min.js",
];
const SHELL = ["./", "./index.html", "./manifest.json"];
const PAGE_KEY = "./index.html";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.all(
        SHELL.concat(LIBS).map((url) =>
          // "reload" skips the browser's HTTP cache, so a fresh deploy never
          // precaches a stale copy of itself. One failure doesn't sink the rest.
          cache.add(new Request(url, { cache: "reload" })).catch(() => {})
        )
      )
    )
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // The page itself: network first, so a reload always gets the newest
  // version when online, with the cached copy only as the offline fallback.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req, { cache: "no-cache" })
        .then((res) => {
          // A redirect has to be handed back as-is for the browser to follow.
          if (res.type === "opaqueredirect") return res;
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((c) => c.put(PAGE_KEY, copy)).catch(() => {});
            return res;
          }
          return caches.match(PAGE_KEY).then((c) => c || res);
        })
        .catch(() => caches.match(PAGE_KEY).then((c) => c || caches.match("./")))
    );
    return;
  }

  // Pinned libraries: cache first.
  if (LIBS.indexOf(req.url) !== -1) {
    event.respondWith(caches.match(req).then((c) => c || fetch(req)));
    return;
  }

  // Other same-origin files (the manifest, icons): network first, cache as backup.
  if (url.origin === self.location.origin) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => caches.match(req).then((c) => c || Response.error()))
    );
    return;
  }

  // Everything else, including ALL Firestore traffic, goes straight to the
  // network untouched. (Intercepting it is what used to produce the
  // "Failed to convert value to 'Response'" errors in the console.)
});
