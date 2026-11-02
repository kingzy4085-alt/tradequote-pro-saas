// TradeQuote PRO service worker: makes the app installable and shows an
// offline notice. Data always comes from the network, never a stale cache.
const OFFLINE_HTML = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>TradeQuote PRO</title></head>
<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#020617;color:#f1f5f9;font-family:system-ui,sans-serif;text-align:center;padding:32px">
<div><h1 style="font-size:30px;margin:0 0 8px">You're offline</h1><p style="color:#94a3b8;margin:0">TradeQuote PRO needs a connection to the server. Reconnect and try again.</p></div></body></html>`;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
  if (event.request.mode !== 'navigate') return;
  event.respondWith(
    fetch(event.request).catch(
      () => new Response(OFFLINE_HTML, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
    )
  );
});
