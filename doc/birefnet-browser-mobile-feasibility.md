# BiRefNet Lite 512 瀏覽器與手機可行性評估

更新日期：2026-07-30

## 結論

`studioludens/birefnet-lite-512` 可以作為本專案瀏覽器版的實驗性 AI 去背後端，但目前不適合直接成為所有裝置的預設方案。

產品定位建議：

- 桌面新版 Chrome／Edge：可列為主要試驗環境。
- Android 新版 Chrome／Edge：技術上可能使用 WebGPU，但裝置差異很大，應標示為實驗性。
- iPhone／iPad：目前不應宣稱正式支援。依 ONNX Runtime Web 的支援表，iOS 瀏覽器沒有 WebGPU execution provider 快速路徑，只能期待 WASM；是否有可接受的速度與記憶體使用量尚未實測。
- Safari、Firefox：先視為 WASM fallback 環境，不承諾有實用速度。

因此，「手機大概率不能用」對產品決策而言大致成立，但需要更精確地拆成：

1. iOS：大概率不具實用性，而不是模型理論上完全無法載入。
2. Android：高階新機可能可用，不能一概排除；中低階裝置與內嵌瀏覽器風險高。

## 評估對象

- 模型：[studioludens/birefnet-lite-512](https://huggingface.co/studioludens/birefnet-lite-512)
- 上游：[ZhengPeng7/BiRefNet](https://github.com/ZhengPeng7/BiRefNet)
- 執行方式：`@huggingface/transformers`／ONNX Runtime Web，在瀏覽器本機執行。
- 授權：模型頁與上游專案均標示 MIT；若納入產品，仍應保存對應授權與著作權聲明。

這不是遠端 API service。模型下載及初始化完成後，推論在使用者裝置上進行，沒有逐次 API 費用，也不需要上傳使用者影片。

## 已確認的模型特性

模型作者提供的資料如下：

- 固定輸入：RGB `512×512`。
- 輸出：單通道 `512×512` logits；經 sigmoid 後作為 alpha mask，再以雙線性插值放回原尺寸。
- fp16 ONNX：約 94 MB。
- fp32 ONNX：約 183 MB。
- 尚無經驗證的 INT8 版本。
- 原始 1024×1024 ONNX 版本在作者測試的 WebGPU 與 WASM 環境都會失敗；512×512 將中間 tensor 面積降為約四分之一。
- 作者宣稱 512 版可在 M1 MacBook Pro 上可靠執行，但沒有提供完整的手機、瀏覽器、耗時或峰值記憶體矩陣。

94 MB 只是權重檔大小，不等於執行時的峰值記憶體。推論還需要中間 tensor、GPU／WASM buffer、輸入輸出影像及 JavaScript 物件；目前沒有足夠資料可為手機訂出最低 RAM。

## 瀏覽器限制

### WebGPU 快速路徑

ONNX Runtime Web 目前的[官方支援表](https://onnxruntime.ai/docs/get-started/with-javascript/web.html#supported-versions)列出：

| 環境 | WebGPU execution provider | 本評估的產品判斷 |
| --- | --- | --- |
| Chrome／Edge on macOS | 支援 | 主要試驗環境 |
| Chrome／Edge on Windows | 支援，但有版本與 fp16 條件 | 可試驗 |
| Chrome／Edge on Android | 支援 | 僅列實驗性，必須實機量測 |
| Chrome／Edge on iOS | 不支援 | 只能考慮 WASM |
| Safari on macOS／iOS | 不支援 | 只能考慮 WASM |
| Firefox | 不支援 | 只能考慮 WASM |

WebGPU 還需要 HTTPS 等 secure context。專案部署於 GitHub Pages 時符合 HTTPS 條件，但瀏覽器「存在 `navigator.gpu`」仍不代表模型一定能完成初始化與 warm-up；adapter limits、driver、fp16 支援及 device loss 都可能造成失敗。

實作上應先嘗試 WebGPU 初始化及一次 warm-up，失敗後才建立新的 WASM session。不能把模型頁範例中的 fallback 註解當成所有錯誤都能自動復原的保證。

### WASM fallback

[ONNX Runtime Web 環境設定文件](https://onnxruntime.ai/docs/tutorials/web/env-flags-and-session-options.html)指出，WASM 多執行緒需要瀏覽器支援並處於 `crossOriginIsolated`。

本專案已透過 `web/public/coi-serviceworker.js` 為 GitHub Pages 補上 cross-origin isolation 行為，所以具備啟用 WASM 多執行緒的基礎。但這只能改善條件，不能證明 BiRefNet Lite 512 在手機上會有可接受的速度或不會發生記憶體壓力。

WASM 應視為：

- 功能 fallback，而不是已確認的手機產品方案。
- 桌面無 WebGPU 時的次要路徑。
- 只有完成 iPhone、iPad、Android 中階機的實測後，才能決定是否對手機開放。

## 與本專案素材的解析度關係

已使用過的實際影片條件是：

- 來源：1280×720。
- 網格：3 欄 × 2 列，共 6 個貼圖。
- 每格約 427×360。
- 每個貼圖取 10 個 master sample points。
- 最終 LINE 動態貼圖上限約 320×270。

若先切格再推論，每個約 427×360 的 crop 會送入 512×512 模型。雖然會有長寬比變形，但遮罩解析度仍接近來源 crop，且高於最終輸出尺寸，因此 512 對這個案例是合理的。

若把整張 1280×720 frame 直接縮成 512×512，每格內容約只剩 171×256，文字、髮絲、描邊和小型裝飾更容易遺失。因此整合時必須採用：

```text
解碼一個來源 frame
  -> 依固定網格切出每個 sticker crop
  -> 每個 crop 個別跑 512×512 BiRefNet
  -> sigmoid 並把 mask 縮放回 crop
  -> 套用 alpha
  -> resize 到既有 sticker canvas
  -> 進入既有 master APNG 流程
```

目前 `web/src/webpipe/masterApng.ts` 是先對整張 frame 做色鍵，再逐格 crop。AI 路徑需要放在 crop 之後；這是 browser adapter 的變更，不應放入平台中立的 `src/core/`。

## 畫質限制

### 可能的改善

本專案目前的 `@imgly/background-removal` medium 模型以 IS-Net 為基礎。BiRefNet 論文在 DIS5K 的 1024×1024 測試中，完整 BiRefNet 對 IS-Net 的細節與整體指標有明顯提升；這構成值得 A/B 測試的理由。

但是該論文結果不能直接證明這個第三方 512 lite export 一定勝過目前的 IMG.LY medium，因為模型大小、權重、輸入解析度及執行環境都不同。

### 本素材的特殊風險

- BiRefNet 是語意前景分割模型。與角色分離的文字、驚嘆號、愛心、速度線或其他裝飾可能被視為背景。
- 黑色背景與黑色頭髮、眼睛、服裝或文字共色時，語意模型原則上比單色 keying 更有機會保留主體細節，但仍需用真實素材驗證。
- 模型只輸出 alpha mask，不會重建或淨化半透明邊緣的 RGB。原背景顏色可能殘留在邊緣，換成其他背景時形成黑邊或色溢。
- 512 固定方形 resize 會扭曲非方形 crop。模型可能容忍語意變形，但細字與極細線條仍可能受影響。

## 影片特有風險

BiRefNet 本質上是圖片模型。官方[影片 notebook](https://github.com/ZhengPeng7/BiRefNet/blob/main/tutorials/BiRefNet_inference_video.ipynb)也是將影片拆成 frames 後逐張推論，沒有 recurrent state、光流或跨幀一致性機制。

因此即使每張靜態結果看起來不錯，APNG 播放時仍可能出現：

- 髮絲和輪廓在相鄰幀抖動。
- 小字或裝飾忽隱忽現。
- 角色內部孔洞時有時無。
- 半透明邊緣強度跳動。

不宜直接使用簡單的逐像素 alpha EMA，因為主體移動時會產生殘影。初版 spike 應先輸出未平滑結果並檢查動畫；若確有閃爍，再評估光流對齊後的 mask smoothing 或其他 temporal stabilization。

## 效能與部署成本

對目前的 6 格 × 10 時間點案例，crop-first 代表 60 次模型推論。

必要的執行策略：

- lazy-load 模型，只有使用者開啟「AI 去背（實驗）」才下載。
- 整個工作只建立並重用一個 session。
- 逐格依序推論；不能用 `Promise.all` 同時跑 60 次。
- 在 Web Worker 中進行推論及主要前後處理，避免凍結 React UI。
- 每次推論後釋放不再使用的 tensor／buffer。
- 提供下載、初始化及處理進度，並允許使用者停止後續格子的處理。

目前 `@imgly/background-removal-data@1.4.5` 的本機安裝資產約 221 MB，Vite 設定會把整個 `dist` 複製到部署產物；實際 medium model 首次使用約需 88 MB，另加相應 runtime。若永久保留 IMG.LY 並再加入 94 MB 的 BiRefNet 及 Transformers.js／ONNX Runtime 資產，部署體積與快取成本會顯著增加。

建議先並存以進行 A/B spike，決定採用者後再移除另一套，不要長期同時配送兩套語意去背 runtime。

模型及 WASM 應固定版本並同源自託管，避免 Hugging Face 可用性、版本漂移及 COEP／CORS 成為執行條件。Transformers.js 提供 [`env.localModelPath`、`env.allowRemoteModels` 與 WASM path](https://huggingface.co/docs/transformers.js/main/en/custom_usage)設定。

## 建議的實驗範圍

先加入不改變既有預設行為的「AI 去背（實驗）」選項，只對桌面 Chrome／Edge 開放。測試素材至少包含目前的真實 3×2 黑背景影片。

需要比較：

1. 不去背。
2. 現有 IMG.LY medium。
3. BiRefNet Lite 512 fp16。

每個方案檢查全部 6 個貼圖、10 個來源時間點：

- 黑色頭髮、眼睛、衣服及輪廓是否保留。
- 與人物分離的文字及裝飾是否完整。
- 邊緣是否有黑邊、色溢或孔洞。
- 最終 320×270 動畫是否有可見的跨幀閃爍。
- 模型首次下載量與初始化時間。
- WebGPU warm-up、單格 p50／p95 推論時間及完成 60 格的總時間。
- 是否發生 device loss、OOM、頁面重載或 UI 長時間無回應。

手機需另外建立至少以下實機矩陣：

- 一台近期高階 Android Chrome。
- 一台中階 Android Chrome。
- 一台近期 iPhone Safari。
- 一台記憶體較小或較舊的 iPhone／iPad。

在取得這些結果前，不能宣稱 mobile supported。

## 採用判斷

| 項目 | 判斷 |
| --- | --- |
| 技術上能整合進目前 web app | 是 |
| 適合目前 3×2、crop-first 的解析度 | 是 |
| 可取代單色 keying 的候選 | 是 |
| 可直接作為預設去背 | 否 |
| 桌面 Chrome／Edge 值得試作 | 是 |
| Android 可正式支援 | 尚未證實 |
| iPhone／iPad 可正式支援 | 否，除非後續 WASM 實測證明可接受 |
| 能保證影片幀間穩定 | 否 |

## 證據狀態

### 已觀察

- 本專案現有 video pipeline、網格裁切順序、cross-origin isolation 設定及 IMG.LY 靜態資產配置。
- 模型卡公開的固定輸入、輸出、模型大小、1024 失敗原因及 512 限制。
- ONNX Runtime Web 官方文件目前列出的 execution provider／browser 支援狀態。
- BiRefNet 官方影片範例採逐幀圖片推論。
- 2026-07-30 的隔離本機 Chrome browser spike：以 fp16 ONNX 建立 WASM session 成功，session 約
  6.9 秒；兩個 512×512 單張 crop 推論分別約 11.7 秒與 10.1 秒。淺藍底人物與「黑髮／黑描邊
  疊在不透明黑底」壓力案例都產生了合理 alpha mask；黑髮沒有整片被移除。

這個 spike 只驗證了桌面 headless Chrome 的單張 WASM 推論與靜態視覺結果。它沒有 WebGPU、
worker、完整影片工作、GitHub Pages 部署、手機或跨幀穩定性的證據。

### 由上述事實推論

- 本專案應先 crop 再推論。
- 512 對目前每格約 427×360、最終約 320×270 的素材合理。
- iOS 缺少 WebGPU 快速路徑時，大型 WASM 模型很可能沒有理想的互動體驗。
- 同時配送 IMG.LY 與 BiRefNet 會增加部署與快取負擔。

### 尚未驗證

- 任何手機的推論速度、記憶體峰值及穩定性。
- 目前真實影片的文字保存率與跨幀閃爍程度。
- BiRefNet Lite 512 對本專案素材是否確實優於 IMG.LY medium。
- WebGPU、worker 和 production-shaped app path 的實際載入、warm-up 與輸出。

因此，本次的 WASM spike 不能把模型作者的成功案例或文件相容性表升格為本專案的桌面 WebGPU、
GitHub Pages 或手機支援證據。

## 參考資料

- [BiRefNet Lite 512 模型卡](https://huggingface.co/studioludens/birefnet-lite-512)
- [BiRefNet 官方 repository（MIT）](https://github.com/ZhengPeng7/BiRefNet)
- [BiRefNet 論文](https://arxiv.org/html/2401.03407)
- [BiRefNet 官方影片逐幀推論 notebook](https://github.com/ZhengPeng7/BiRefNet/blob/main/tutorials/BiRefNet_inference_video.ipynb)
- [ONNX Runtime Web 支援版本表](https://onnxruntime.ai/docs/get-started/with-javascript/web.html#supported-versions)
- [ONNX Runtime WebGPU execution provider](https://onnxruntime.ai/docs/tutorials/web/ep-webgpu.html)
- [ONNX Runtime Web 環境與 session 設定](https://onnxruntime.ai/docs/tutorials/web/env-flags-and-session-options.html)
- [Transformers.js 自託管模型與 WASM 設定](https://huggingface.co/docs/transformers.js/main/en/custom_usage)
