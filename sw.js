const C = "resitku-v11";
const FILES = ["./", "index.html", "style.css", "app.js", "db.js", "reliefs.js", "manifest.json", "icon.svg", "icon-192.png", "icon-512.png", "apple-touch-icon.png", "install.js", "drive.js", "sync-ui.js", "config.js"];
self.addEventListener("install", e => { e.waitUntil(caches.open(C).then(c => c.addAll(FILES))); self.skipWaiting(); });
self.addEventListener("activate", e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== C).map(k => caches.delete(k)))).then(() => self.clients.claim())));
// Network-first untuk fail app (senang update), fallback cache bila offline. CDN (OCR/JSZip) pun di-cache.
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  if (/googleapis\.com|accounts\.google\.com/.test(e.request.url)) return;
  e.respondWith(fetch(e.request).then(r => {
    if (r.ok) { const cp = r.clone(); caches.open(C).then(c => c.put(e.request, cp)); }
    return r;
  }).catch(() => caches.match(e.request)));
});
