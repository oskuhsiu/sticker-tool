# sticker-tool web

sticker-tool 的**純靜態網頁版**——CLI 的功能搬進瀏覽器，可直接部署到 GitHub Pages。
全程在瀏覽器內運算（Canvas + wasm），**圖片與影片不會上傳到任何伺服器**。

## 功能（對應 CLI 指令）

| 分頁 | 對應 CLI | 說明 |
|---|---|---|
| 本機圖片打包 | `build` | 多張圖 → 去背 → fit → 描邊 → ≤1MB → main/tab → zip |
| 組圖切格 | `gen` | 組圖（透明/綠幕/不透明底）→ 偵測背景 → 去背 → gutter 切格 → 校正 → 靜態包 |
| 動態 APNG | `anim` | 單組圖 → 一段 APNG；或整包（每貼圖一組影格）→ 動態上架包 |
| 影片 → APNG | —（Web only） | 固定格線影片 → master APNG → 逐張調整 → LINE ZIP / Project ZIP |
| 產圖 Prompt | `prompt` | 產生餵外部 AI 工具的組圖 prompt（靜態 + 動態影格） |

### 影片 → APNG

- 支援目前瀏覽器能解碼的本機 MP4/MOV/WebM；來源影片與圖片一樣不會上傳。
- 使用者先選可編輯起訖秒數、任意正整數來源格數、固定網格與 10–60 個 master 取樣點。來源格數
  可以少於 LINE 包規定的 8 張，方便先建立 master／Project；工具依時間軸逐點
  seek，每個來源畫格同時裁給所有格子，再每 10 格 flush 成 lossless master APNG。
- 影片的單色色鍵預設關閉，避免黑底同時挖掉黑髮、眼睛或文字描邊；只在主體完全不含背景色時開啟。
- master 建完即釋放影片 decoder。逐張開始/結束秒數、5–20 格、1/2/3/4 秒、loops 與減色
  都從 master APNG 解碼重編，不再回讀影片。
- 「原切版本」固定不覆寫；「目前版本」保存已套用的調整，並顯示 timestamps、delays、
  不同畫格數、透明/前景 pixels、尺寸與 bytes。
- LINE ZIP 仍只接受 8/16/24 張，只含 main/tab/編號 APNG，且 validation error 時停用正式下載。Project ZIP 另含
  master chunks、原切/目前成品、metrics 與 manifest，可重新上傳直接回到已調整狀態。
  Project ZIP 預設不含來源影片，也不處理來源音軌。

### 動態 APNG（單組圖模式）的選項

- **自動去背**（預設開）：偵測背景型態做色鍵——透明→原樣、綠幕→綠色鍵、其他單色→
  以邊框平均色做單色色鍵；也可展開「背景色」**直接點圖指定**背景色。關閉＝直接用原圖 alpha。
  此流程**不使用 @imgly 模型**（不必下載 ~88MB，也避免卡在模型下載）。
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
- 去背模型（~88MB）build 時從 `@imgly/background-removal-data` 複製進 `dist/imgly/` 自託管，
  首次使用下載、之後走瀏覽器快取；不依賴第三方 CDN。
  **組圖切格／動態 APNG 的 sheet 流程不用模型**——一律色鍵（綠幕／單色，可點圖選色）；
  模型只剩「本機圖片打包」與整包模式的逐格去背在用。
- `public/coi-serviceworker.js` 補 COOP/COEP header（GitHub Pages 不能自訂 header），
  讓 onnxruntime-web 可用多執行緒 wasm；不支援時自動退回單執行緒（較慢但可用）。

## 開發

```bash
npm install
npm run dev        # 開發伺服器
npm run build      # typecheck + build → dist/
npm run test:video # Project ZIP encode/export/import/decode round-trip
npm run preview    # 本機 serve dist/
npm run smoke      # 端到端冒煙測試（需先 preview；用法見 scripts/smoke.mjs 開頭）
npm run smoke:video -- http://127.0.0.1:4179/ # 需 ffmpeg；影片 workflow E2E
```

## 部署到 GitHub Pages

repo Settings → Pages → Source 選「**GitHub Actions**」，之後 push `master` 即由
`.github/workflows/deploy-pages.yml` 自動 build + 部署。`vite.config.ts` 的 `base: './'`
讓產物在任何子路徑（`https://<user>.github.io/<repo>/`）都能直接運作。
