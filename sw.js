const VERSION = "v8";
const STATIC = `grindstone-${VERSION}`;

const BASE = new URL(self.registration.scope); // e.g. https://user.github.io/grindstone/
const A = (p) => new URL(p, BASE).toString();

const ASSETS = [
	A("./"),
	A("./index.html"),
	A("./manifest.webmanifest"),
	A("./css/styles.css"),
	A("./js/app.js"),
	A("./icons/icon-192.png"),
	A("./icons/icon-512.png"),
	"https://cdnjs.cloudflare.com/ajax/libs/bootstrap/5.3.7/css/bootstrap.min.css",
	"https://cdnjs.cloudflare.com/ajax/libs/bootstrap/5.3.7/js/bootstrap.bundle.min.js",
	"https://cdnjs.cloudflare.com/ajax/libs/bootstrap-icons/1.13.1/font/bootstrap-icons.min.css",
];

self.addEventListener("install", (e) => {
	e.waitUntil(caches.open(STATIC).then((c) => c.addAll(ASSETS)));
	self.skipWaiting();
});

self.addEventListener("activate", (e) => {
	e.waitUntil(
		(async () => {
			const keys = await caches.keys();
			await Promise.all(keys.filter((k) => k !== STATIC).map((k) => caches.delete(k)));
			await self.clients.claim();
		})()
	);
});

self.addEventListener("message", (e) => {
	if (e.data?.type === "SKIP_WAITING") self.skipWaiting();
});

// SINGLE fetch handler (network-first for shell, cache-first otherwise)
const SHELL = [A("./index.html"), A("./js/app.js")];

self.addEventListener("fetch", (e) => {
	const url = e.request.url;
	const isShell = e.request.mode === "navigate" || SHELL.includes(url);
	e.respondWith(isShell ? networkFirst(e.request) : cacheFirst(e.request));
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
