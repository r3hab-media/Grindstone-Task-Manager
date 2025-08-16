// sw.js
const VERSION = "v4"; // bump on every deploy
const STATIC = `grindstone-${VERSION}`;
const ASSETS = [
	"/",
	"/index.html",
	"/manifest.webmanifest",
	"/css/styles.css",
	"/js/app.js",
	"https://cdnjs.cloudflare.com/ajax/libs/bootstrap/5.3.7/css/bootstrap.min.css",
	"https://cdnjs.cloudflare.com/ajax/libs/bootstrap/5.3.7/js/bootstrap.bundle.min.js",
	"https://cdnjs.cloudflare.com/ajax/libs/bootstrap-icons/1.13.1/font/bootstrap-icons.min.css",
];

self.addEventListener("install", (e) => {
	e.waitUntil(caches.open(STATIC).then((c) => c.addAll(ASSETS)));
	self.skipWaiting(); // take over without waiting
});

self.addEventListener("activate", (e) => {
	e.waitUntil(
		(async () => {
			const keys = await caches.keys();
			await Promise.all(keys.filter((k) => k !== STATIC).map((k) => caches.delete(k)));
			await self.clients.claim(); // control all pages now
		})()
	);
});

self.addEventListener("message", (e) => {
	if (e.data?.type === "SKIP_WAITING") self.skipWaiting();
});

// Network-first for app shell; cache-first for everything else
self.addEventListener("fetch", (e) => {
	const req = e.request;

	const isAppShell = req.mode === "navigate" || new URL(req.url).pathname === "/index.html" || new URL(req.url).pathname === "/js/app.js";

	if (isAppShell) {
		e.respondWith(networkFirst(req));
	} else {
		e.respondWith(cacheFirst(req));
	}
});

async function networkFirst(req) {
	try {
		const res = await fetch(req);
		const c = await caches.open(STATIC);
		if (req.method === "GET") c.put(req, res.clone());
		return res;
	} catch {
		const cached = await caches.match(req);
		return cached || Response.error();
	}
}
async function cacheFirst(req) {
	const cached = await caches.match(req);
	return cached || fetch(req);
}
