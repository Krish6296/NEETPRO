const CACHE_NAME = "neet-pro-app-shell-v1";

async function cacheAsset(url, cache, visited) {
  const resolved = new URL(url, self.location.origin);
  if (resolved.origin !== self.location.origin || visited.has(resolved.href)) return;
  visited.add(resolved.href);
  const response = await fetch(resolved.href, { cache: "reload" });
  if (!response.ok) throw new Error(`Could not cache ${resolved.href} (${response.status}).`);
  const copy = response.clone();
  await cache.put(resolved.href, copy);
  if (!resolved.pathname.endsWith(".js")) return;
  const script = await response.text();
  const imports = [...script.matchAll(/(?:from\s*|import\s*\(\s*|import\s*)(["'])([^"']+\.js(?:\?[^"']*)?)\1/g)]
    .map((match) => new URL(match[2], resolved).href);
  await Promise.all(imports.map((asset) =>
    cacheAsset(asset, cache, visited).catch((error) => console.error("Could not cache an app-shell module.", error)),
  ));
}

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    const response = await fetch("/", { cache: "reload" });
    if (!response.ok) throw new Error(`Could not cache the app shell (${response.status}).`);
    await cache.put("/", response.clone());
    const html = await response.text();
    const assets = [...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css)(?:\?[^"]*)?)"/g)]
      .map((match) => new URL(match[1], self.location.origin).href);
    const visited = new Set();
    await Promise.all(assets.map(async (url) => {
      try {
        await cacheAsset(url, cache, visited);
      } catch (error) {
        console.error("Could not cache an app-shell asset.", error);
      }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const cacheNames = await caches.keys();
    await Promise.all(cacheNames
      .filter((name) => name.startsWith("neet-pro-app-shell-") && name !== CACHE_NAME)
      .map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api")) return;

  if (request.mode === "navigate") {
    event.respondWith((async () => {
      let response;
      try {
        response = await fetch(request);
      } catch {
        const cachedShell = await caches.match("/");
        if (cachedShell) return cachedShell;
        return new Response("NEET Pro is not available offline yet. Open the app while online first.", {
          status: 503,
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        });
      }
      if (response.ok) {
        try {
          const cache = await caches.open(CACHE_NAME);
          await cache.put("/", response.clone());
        } catch (error) {
          console.error("Could not update the cached app shell.", error);
        }
      }
      return response;
    })());
    return;
  }

  if (["script", "style", "font", "image"].includes(request.destination)) {
    event.respondWith((async () => {
      const cachedAsset = await caches.match(request);
      if (cachedAsset) return cachedAsset;
      const response = await fetch(request);
      if (response.ok) {
        try {
          const cache = await caches.open(CACHE_NAME);
          await cache.put(request, response.clone());
        } catch (error) {
          console.error("Could not update a cached app asset.", error);
        }
      }
      return response;
    })());
  }
});
