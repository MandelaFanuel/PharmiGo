const APP_VERSION = new URL(self.location.href).searchParams.get("v") || "v1";
const STATIC_CACHE = `pharmigo-static-${APP_VERSION}`;
const IS_LOCAL_DEV_HOST = ["localhost", "127.0.0.1"].includes(self.location.hostname);
const APP_SHELL = [
  "/",
  "/manifest.webmanifest",
  "/apple-touch-icon.png",
  "/favicon.svg",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-512.png",
];

const MEDICAL_PATH_PATTERNS = [
  /\/api\/prescriptions\/\d+\/document\/?$/i,
  /\/private_media\//i,
  /\/media\/prescriptions\//i,
];

function isMedicalRequest(url) {
  return MEDICAL_PATH_PATTERNS.some((pattern) => pattern.test(url.pathname));
}

function isStaticAssetRequest(request, url) {
  if (request.destination && ["style", "script", "worker", "font", "image"].includes(request.destination)) {
    return true;
  }
  return url.origin === self.location.origin && APP_SHELL.includes(url.pathname);
}

self.addEventListener("install", (event) => {
  if (IS_LOCAL_DEV_HOST) {
    event.waitUntil(self.skipWaiting());
    return;
  }

  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  if (IS_LOCAL_DEV_HOST) {
    event.waitUntil(
      caches.keys()
        .then((keys) => Promise.all(keys.map((key) => caches.delete(key))))
        .then(() => self.registration.unregister())
        .then(() => self.clients.claim())
    );
    return;
  }

  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== STATIC_CACHE)
          .map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) {
    return cached;
  }

  const response = await fetch(request);
  if (response && response.ok) {
    const cache = await caches.open(STATIC_CACHE);
    await cache.put(request, response.clone());
  }
  return response;
}

self.addEventListener("fetch", (event) => {
  if (IS_LOCAL_DEV_HOST) {
    return;
  }

  const { request } = event;
  if (request.method !== "GET") {
    return;
  }

  const url = new URL(request.url);

  if (isMedicalRequest(url)) {
    event.respondWith(fetch(request));
    return;
  }

  if (isStaticAssetRequest(request, url)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  if (url.origin === self.location.origin && url.pathname.startsWith("/api/")) {
    event.respondWith(fetch(request));
    return;
  }

  event.respondWith(
    fetch(request).catch(async () => {
      const cached = await caches.match(request);
      return cached || caches.match("/");
    })
  );
});
