# sticker-tool web

sticker-tool 的**純靜態網頁版**——CLI 的功能搬進瀏覽器，可直接部署到 GitHub Pages。
預設在瀏覽器內運算（Canvas + wasm）。Build、Sheet、Anim、Video 都可選：不去背、單色色鍵、
IMG.LY 本機去背、本機 BiRefNet，或使用者自行啟動的 Colab BiRefNet。IMG.LY 沒有 Colab 模式。

## 功能（對應 CLI 指令）

| 分頁 | 對應 CLI | 說明 |
|---|---|---|
| 本機圖片打包 | `build` | 多張圖 → 去背 → fit → 描邊 → ≤1MB → main/tab → zip |
| 組圖切格 | `gen` | 組圖（透明/綠幕/不透明底）→ 偵測背景 → 去背 → gutter 切格 → 校正 → 靜態包 |
| 動態 APNG | `anim` | 單組圖 → 一段 APNG；或整包（每貼圖一組影格）→ 動態上架包 |
| 影片 → APNG | —（Web only） | 固定格線影片 → master APNG → 逐張調整 → LINE ZIP / Project ZIP |
| 產圖 Prompt | `prompt` | 產生餵外部 AI 工具的組圖 prompt（靜態 + 動態影格） |

另有獨立、可直接連結的 **Colab + BiRefNet 教學**：`#/colab-birefnet`。它提供可下載的 Notebook；
使用者可選 lite/full/dynamic、auto/GPU/CPU、512/1024，先用內建 astronaut 圖量測結果、實際推論尺寸與每張秒數，
再決定是否啟動臨時 API。dynamic 保留 crop 長寬比、以 512/1024 為最長邊上限，並將兩邊調整到 32 的倍數。

### 影片 → APNG

- 支援目前瀏覽器能解碼的本機 MP4/MOV/WebM；來源影片與圖片一樣不會上傳。
- 使用者先選可編輯起訖秒數、任意正整數來源格數、固定網格與 10–60 個 master 取樣點。來源格數
  可以少於 LINE 包規定的 8 張，方便先建立 master／Project；工具依時間軸逐點
  seek，每個來源畫格同時裁給所有格子，再每 10 格 flush 成 lossless master APNG。master 預設 20 格，
  對齊 LINE Creators App 的 High smoothness；30/40/60 僅供需要更細時間編輯時選用。
- 影片的單色色鍵預設關閉，避免黑底同時挖掉黑髮、眼睛或文字描邊；只在主體完全不含背景色時開啟。
- 本機 BiRefNet 預設關閉。使用者確認並開始工作後，才下載固定 revision 的 fp16 ONNX（98,484,532 bytes，
  約 94 MiB；44.4M 是參數量，不是檔案大小）。模型在 Web Worker 內逐 crop 順序執行，優先用 WebGPU，
  不可用時改跑較慢的 WASM；模型由瀏覽器快取，素材不會上傳。所有裝置都會看到耗時警告，手機／平板
  另會被告知可能耗電、OOM 或跑不完，但功能不會被封鎖。
- Colab BiRefNet 預設關閉。啟用前會要求先跑 Notebook benchmark，並顯示
  `master 時間點 × 裁切格數` 的請求數。原始影片、完整來源 frame、音訊與 Project ZIP 不會上傳。
- 連線只接受 Notebook 輸出的 `https://*.trycloudflare.com/remove`，禁止 redirect；隨機 session key
  與臨時 URL 只存在本次 React 記憶體，不會進 storage、URL、cookie、log、下載檔或 Project ZIP。
- 免費 Colab 與 Quick Tunnel 都沒有 SLA。runtime 或最後一格停止後連線立即失效，下次必須重新 Run All 並貼回新連線。
- master 建完即釋放影片 decoder。逐張開始/結束秒數、5–20 格、1/2/3/4 秒、loops 與減色
  都從 master APNG 解碼重編，不再回讀影片。
- 「原切版本」固定不覆寫；「目前版本」保存已套用的調整，並顯示 timestamps、delays、
  不同畫格數、透明/前景 pixels、尺寸與 bytes。
- LINE ZIP 仍只接受 8/16/24 張，只含 main/tab/編號 APNG，且 validation error 時停用正式下載。Project ZIP 另含
  master chunks、原切/目前成品、metrics 與 manifest，可重新上傳直接回到已調整狀態。
  Project ZIP 預設不含來源影片，也不處理來源音軌。

### 共用去背選項

- **不去背**：保留來源 alpha；Build、整包 Anim 與 Video 的預設值。
- **單色色鍵**：本機 Canvas 運算、不下載模型；Sheet／單組圖 Anim 預設使用此模式，並保留自動偵測或點圖選色流程。
- **IMG.LY（本機）**：只在選取並開始工作後下載自託管 medium 模型與 WASM。resources 合計
  88,188,479 bytes（約 84 MiB）；實測乾淨桌面 Chrome 處理 8 張不透明測試圖約 116 秒，但不是速度保證。
  手機可能記憶體不足或跑不完。IMG.LY 不會上傳圖片，也不提供 Colab 版。
- **BiRefNet（本機，實驗）**：下載約 94 MiB fp16 ONNX，在 Web Worker 逐張執行；44.4M 是參數量，
  不是下載大小。優先 WebGPU、失敗時可改本機 WASM；手機可能跑很久、OOM 或無法完成。
- **BiRefNet（Colab）**：逐張圖片或已裁切格子送往使用者自己的臨時 endpoint。必須先跑 benchmark；
  免費 Colab／Quick Tunnel 沒有 SLA，URL 與 session key 僅存在目前頁面記憶體。
- 所有模型錯誤都會直接顯示，不會假裝成功或靜默改跑色鍵。組圖模型模式會對重疊的名目格子推論，
  合併完整 sheet alpha 後才做 component-aware 切格，避免跨格主體被 mask 邊界截斷。

### 動態 APNG（單組圖模式）的其他選項
- **網格防呆**（預設開）：由前景縫隙推斷內容實際欄/列數，與指定網格不符就擋下並提示
  （如「內容看起來是 4×4，與指定的 5×4 不符」）——切下去會整組錯位漂移。
  確定網格沒錯可取消勾選強制繼續。
- **預覽循環播放**（預設開）：預覽用副本把 APNG `num_plays` 改 0（無限循環）方便看；
  下載檔維持設定的 1–4 次循環。另有「↻ 重播」。
- **減色**（預設自動）：自動＝超過 1MB 才沿品質階梯減色；強制 256/128/64 色＝
  一開始就減（檔案明顯較小，如 960KB → ~260KB）。
- **手動排版**：切格後逐格拖曳對位（onion-skin 殘影、方向鍵微調、Shift×10）、
  畫布即時播放測試、滿意後打包成 APNG——自動對齊不理想時的人工出口。

CLI 的 `init` 不需要（網頁表單即設定檔）；AI 產圖不內建（char-gen 依賴 codex，無法在
純靜態網頁執行）——改用「產圖 Prompt」分頁接外部產圖工具，產出組圖拖回來切格打包。

## 架構

- `../src/core/*` 純邏輯（規格/驗證/切線規劃/網格決策/prompt）**零改動直接重用**（vite alias `@core`）。
- `src/webpipe/*` 為 CLI `src/pipeline/*` 的瀏覽器重寫：sharp → Canvas/TypedArray、
  `@imgly/background-removal-node` → `@imgly/background-removal`（onnxruntime-web）、
  APNG 仍用 upng-js（同一顆編碼器）、zip 用 fflate。
- `src/webpipe/colabBirefnet.ts` 將單張 crop POST 到臨時 Colab endpoint，限制 URL／輸入／response bytes，
  驗證同尺寸灰階 PNG mask，再把 mask 乘回本機 alpha。
- `src/webpipe/localBirefnet*.ts` 透過 worker lazy-load `@huggingface/transformers`，固定模型 revision，
  逐 crop 本機推論、套回來源 alpha，並在取消或 master 結束時釋放 worker/session。
- `src/webpipe/backgroundRemovalJob.ts` 將五種模式轉成每次工作的序列 remover；
  `sheetBackgroundRemoval.ts` 合併重疊 crop 的 alpha，再交給既有 component-aware sheet extraction。
- `../examples/colab/sticker-tool-birefnet-colab.ipynb` 提供模型選項、astronaut benchmark、FastAPI
  與有 SHA-256 驗證的固定版 Cloudflare Quick Tunnel client。
- IMG.LY 模型 build 時從 `@imgly/background-removal-data` 複製進 `dist/imgly/` 自託管，
  首次選用才下載、之後走瀏覽器快取；不依賴第三方 CDN。非 IMG.LY 模式不會載入它。
- Transformers.js 的相符 ORT WASM／worker assets 會複製到 `dist/transformers/`；BiRefNet 權重則在
  使用者明確啟動本機模式時從固定 Hugging Face revision 下載並進 browser cache。
- `public/coi-serviceworker.js` 補 COOP/COEP header（GitHub Pages 不能自訂 header），
  讓 onnxruntime-web 可用多執行緒 wasm；不支援時自動退回單執行緒（較慢但可用）。

## 開發

```bash
npm install
npm run dev        # 開發伺服器
npm run build      # typecheck + build → dist/
npm run test:colab # Notebook / URL guard / request / mask-alpha contract
npm run test:local-birefnet # pinned model metadata / alpha composition / progress contract
npm run test:background-removal # common mode / sheet-mask merge / animation ordering contract
npm run test:video # Project ZIP encode/export/import/decode round-trip
npm run preview    # 本機 serve dist/
npm run smoke      # 端到端冒煙測試（需先 preview；用法見 scripts/smoke.mjs 開頭）
npm run smoke:local-birefnet -- http://127.0.0.1:4180/ # 需另開 Vite dev；首次下載約 94 MiB
npm run smoke:video -- http://127.0.0.1:4179/ # 需 ffmpeg；影片 workflow E2E
```

## 部署到 GitHub Pages

repo Settings → Pages → Source 選「**GitHub Actions**」，之後 push `master` 即由
`.github/workflows/deploy-pages.yml` 自動 build + 部署。`vite.config.ts` 的 `base: './'`
讓產物在任何子路徑（`https://<user>.github.io/<repo>/`）都能直接運作。
