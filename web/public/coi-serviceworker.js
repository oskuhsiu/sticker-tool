/*
 * COOP/COEP via service worker（GitHub Pages 無法設自訂 header 的標準解法，
 * 參考 gzuidhof/coi-serviceworker 的精簡實作）。
 * 讓頁面 crossOriginIsolated=true → onnxruntime-web 可用 SharedArrayBuffer 多執行緒。
 * 註冊失敗或瀏覽器不支援時，頁面照常運作（去背退回單執行緒，較慢）。
 */
if (typeof window === 'undefined') {
  // ---- service worker 端 ----
  self.addEventListener('install', () => self.skipWaiting());
  self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
  self.addEventListener('fetch', (e) => {
    const req = e.request;
    if (req.cache === 'only-if-cached' && req.mode !== 'same-origin') return;
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res.status === 0) return res;
          const headers = new Headers(res.headers);
          headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
          headers.set('Cross-Origin-Opener-Policy', 'same-origin');
          headers.set('Cross-Origin-Resource-Policy', 'cross-origin');
          return new Response(res.body, {
            status: res.status,
            statusText: res.statusText,
            headers,
          });
        })
        .catch((err) => console.error(err)),
    );
  });
} else {
  // ---- 頁面端：註冊 + 首次註冊後重載一次讓 header 生效 ----
  (() => {
    if (window.crossOriginIsolated) return;
    if (!('serviceWorker' in navigator)) return;
    // 避免無限重載：每個分頁只自動重載一次
    const KEY = 'coi-reloaded';
    navigator.serviceWorker
      .register(document.currentScript.src)
      .then((reg) => {
        reg.addEventListener('updatefound', () => window.sessionStorage.removeItem(KEY));
        if (reg.active && !navigator.serviceWorker.controller) {
          if (!window.sessionStorage.getItem(KEY)) {
            window.sessionStorage.setItem(KEY, '1');
            window.location.reload();
          }
        }
      })
      .catch((e) => console.warn('COI service worker 註冊失敗（去背將以單執行緒執行）：', e));
  })();
}
