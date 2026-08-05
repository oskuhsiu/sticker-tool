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
    // 只代理「需要被加上 COOP/COEP/CORP」的請求：
    //   - 導覽（document）：讓頁面回應帶 COOP/COEP → crossOriginIsolated=true（多執行緒 wasm）
    //   - no-cors 跨來源子資源：在 require-corp 下要補 CORP 才載得進來
    // 同源與 cors 子資源在 require-corp 下本來就允許、不需補 header，所以直接放行、不攔截。
    // 這很關鍵：去背的 ~80MB imgly 模型是同源大檔，若經 SW 代理重抓（fetch+new Response
    // 重組 body），在部分手機/in-app（WebKit）瀏覽器會失敗（TypeError: Load failed）而中止打包；
    // BiRefNet 的 ~94 MiB 模型也是大檔，但由 Hugging Face 以 CORS 授權；讓該 cors fetch
    // 直連可避免 Firefox 經 SW 重組串流時以 NS_BINDING_FAILED 中止。這不影響
    // crossOriginIsolated，因為 COEP 對 cors request 由 CORS 控制。
    const isNavigate = req.mode === 'navigate';
    const sameOrigin = new URL(req.url).origin === self.location.origin;
    const isCors = req.mode === 'cors';
    if (!isNavigate && (sameOrigin || isCors)) return;
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
