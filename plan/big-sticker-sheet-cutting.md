# Big Sticker 組圖切格與靜態切割示意計畫

- 狀態：已實作並完成自動驗收
- 日期：2026-08-04
- 實作與驗收日期：2026-08-04
- 範圍：Web `組圖切格` 工作流，以及共用 LINE 規格／驗證
- 官方基準：[LINE Big Sticker Creation Guidelines](https://creator.line.me/en/guideline/bigsticker/)
- 不包含：新增 CLI command、`本機圖片打包` 大貼圖模式、動態大貼圖、投稿文字欄位或 LINE 審核結果保證
- 交付證據：root typecheck/build、67 個 root tests、Web typecheck/build、browser smoke

## 1. 結論先行

在既有 `組圖切格` 分頁加入「一般靜態貼圖／大貼圖」規格選擇，不另開分頁。上傳組圖後、開始去背與切格前，立即顯示依目前 `cols × rows`、張數與 row-major 順序繪製的切割示意。

大貼圖沿用既有去背、元件式抽格、描邊、疊字、main/tab 與 ZIP 流程，但使用獨立規格：

| 項目 | 大貼圖限制 |
|---|---|
| 張數 | 8、16、24、32 或 40 |
| 單張尺寸 | 最小 `80×524`、最大 `396×660` px |
| 長寬 | 皆須為偶數 |
| 格式 | 透明背景 PNG、RGB、至少 72 dpi |
| 單張檔案 | ≤ `1,000,000` bytes |
| ZIP | ≤ `60,000,000` bytes |
| main / tab | `240×240` / `96×74` px |
| 外圍留白 | 不主動預留；LINE 會在顯示時加入適當 margin |

瀏覽器 Canvas 產出的 PNG 是 RGB/RGBA；目前 pipeline 不寫入或驗證 PNG DPI metadata，因此本版不宣稱能由檔案 metadata 證明 72 dpi。像素尺寸、PNG、alpha、偶數、單檔與 ZIP 限制則由程式驗證。

## 2. 實作前現況證據

> 本節保留計畫建立時的 source baseline；完成後的行為與證據見第 10 節及目前 source。

| 現況 | Source 證據 | 缺口 |
|---|---|---|
| `SheetTab` 固定用一般靜態規格 | `web/src/ui/SheetTab.tsx:8`、`:129`、`:154` | 無法選 `396×660` 的大貼圖規格，也沒有最小尺寸驗證 |
| 組圖上傳後只顯示檔名 | `web/src/ui/SheetTab.tsx:196` | 使用者在昂貴去背完成前看不到格線、編號或未使用格 |
| 實際切格會依透明縫修正 nominal cuts | `web/src/webpipe/sheetAnalysis.ts:184-222`、`:242` | 預覽必須明示它是「預計等分格」，不可假裝是去背後的最終吸附切線 |
| 靜態 fit 預設四周保留 10 px | `web/src/webpipe/processStatic.ts:36-50` | Big Sticker 官方明示不需自行加 margin |
| `fitCanvas(trim)` 只有最大 bounds | `web/src/webpipe/fitCanvas.ts:18-59` | 寬或高較小的內容可能輸出低於 `80×524` |
| shared core 只有 static/animated | `src/core/spec.ts:11-62`、`:71-100` | 大貼圖限制尚無唯一真相，無法由 `validatePack` 驗證 |
| main/tab/ZIP 已可共用 | `web/src/webpipe/mainTab.ts`、`web/src/webpipe/zip.ts` | 無需另造打包器 |

## 3. 動工前需求審視（質疑 → 刪除 → 優化）

### Step 1 — 需求審視

| 需求 | 判定 | 理由 |
|---|---|---|
| `組圖切格` 支援 Big Sticker | 成立 | 使用者明確指定 LINE Big Sticker；若仍用 `370×320`，每張高度必然低於官方最小 `524px` |
| 原一般靜態切格顯示切割示意 | 成立 | 現在上傳 `4×2` 圖後只顯示檔名，選錯 `4×4` 要到處理後才發現 |
| 示意與圖片 bounds 精確對齊 | 成立 | 既有影片 grid 曾因 `<img>` 與 SVG 尺寸不同而錯位；靜態示意須共用同一個 positioned wrapper |
| 預覽顯示去背後吸附透明縫的最終切線 | 刪除 | IMG.LY/BiRefNet 可能先下載約 84 MiB 模型；上傳即推論會把輕量示意變成昂貴工作，且使用者只要求切割示意 |
| 新增獨立「大貼圖」分頁 | 刪除 | 一般與大貼圖只有規格、margin 與尺寸策略不同；第二個分頁會複製 `SheetTab` 的 8/16/24/32/40、去背與 ZIP 流程 |
| `本機圖片打包` 同時支援大貼圖 | 刪除 | 本次指定的是 sticker「切割」；`BuildTab` 不切 sprite sheet，擴張後也不能驗證這次最在意的格線示意 |
| CLI 同時支援大貼圖 | 刪除 | 使用者要求 Web 基本切割功能；新增 config schema/command 不是本次 Web 流程成立的必要條件 |
| 驗證 Creator/Title/Description/Copyright 字數 | 刪除 | 現有工具不收投稿 metadata；加入四組欄位不影響 PNG 切格是否合規 |
| 自動判斷「太長、辨識度差」等內容審核 | 刪除 | 官方將其列為非建議內容，不是可由尺寸 metadata 決定的硬性上傳限制 |

### Step 2 — 刪除後的最小範圍

- 不建立第二套 cutter；同一 `SheetTab` 以 `stickerKind` 切換規格。
- 不建立第二套 ZIP 或 main/tab；沿用既有 `buildMainTab`、`buildPackZip`。
- 不在上傳時執行模型、色鍵或 `cutSheet`；預覽只畫 nominal equal grid，caption 說明正式處理會吸附透明縫。
- 不為 Big Sticker 增加 margin、safe area 或可調 min/max 欄位；官方常數直接固定在 shared core。
- 不修改 CLI config 契約；`big` 只由 Web Sheet adapter 傳入 shared validator。

### Step 3 — 優化剩餘設計

- 將大貼圖規格放在 `src/core/spec.ts`，由 `maxBounds`、張數與 validation 共用。
- 在現有 browser `fitCanvas(trim)` 增加選用的最小畫布尺寸；一般靜態呼叫不傳值，行為保持不變。
- 切割示意沿用影片預覽已驗證的「relative wrapper + absolute SVG」結構，但建立 Sheet 專用元件，避免耦合 Video domain type。

## 4. 架構決策

### 4.1 共用型別與規格

- `src/core/spec.ts` 新增 `BIG_STICKER_SPEC`：`minWidth=80`、`minHeight=524`、`maxWidth=396`、`maxHeight=660`、`maxBytes=1_000_000`、counts `8/16/24/32/40`、margin `0`。
- `StickerKind` 加入 `'big'`。CLI/config normalization 仍只產生 `'static' | 'animated'`；Web Sheet 可明確傳入 `'big'`。
- `allowedCounts('big')` 與 `maxBounds('big')` 回傳大貼圖常數；不得由 UI 重複寫數字。
- 新增 `validateBigStickerImage()`，並由 `validatePack({ kind: 'big' })` 路由。`main` 只有 animated 才要求 APNG，所以 big 沿用靜態 main/tab 規則。

### 4.2 大貼圖 fit 行為

處理順序維持：去背 → trim → 等比縮放 → 建立偶數透明畫布 → 描邊／文字 → PNG byte fitting。

- 最大畫布：`396×660`。
- 最小畫布：`80×524`。
- `marginPx=0`，不額外預留官方未要求的 10 px。
- 內容先以最大畫布等比縮放；trim canvas 若小於 minimum，再以透明 padding 置中補到 minimum。
- minimum 只補畫布，不非等比拉伸內容；最小值與最大值都必須保持偶數。
- 若 optional minimum 大於 maximum，`fitCanvas` 立即拋出明確錯誤，不靜默 clamp 成不可能的契約。

### 4.3 切割示意

- 選檔後立即為每張 sheet 建立 object URL，unmount／換檔時 revoke。
- 圖片與 SVG 放在同一個 `position: relative; display: inline-block` wrapper；兩者皆覆蓋相同 rendered bounds。
- SVG 依 `cols×rows` 畫 equal-grid rect；啟用格以 row-major 顯示 `01…40`，最後一張 sheet 的多餘格以 muted 樣式顯示但不編號。
- caption 顯示檔名、`cols×rows`、該張採用格數，以及「正式切格會依透明縫微調」。
- `gridText`、count、角色包與檔案列表變更時只重新算 overlay，不解碼點陣、不啟動去背。

## 5. 分割目標與 Agent 所有權

### 目標 A — Shared core 規格與驗證

**Owner：Agent A**

檔案所有權：

- `src/core/spec.ts`
- `src/core/validate.ts`
- `.gitignore`（只新增新測試的 allow rule）
- `test/bigSticker.test.ts`（新增）

交付：

1. 加入 `BIG_STICKER_SPEC` 與 `'big'` kind 路由。
2. 驗證 min/max、偶數、alpha、1 MB、合法張數、main/tab 與 60 MB ZIP。
3. 測試邊界 `80×524`、`396×660` 通過；`78×524`、`80×522`、`398×660`、`396×662`、奇數、無 alpha、超 bytes 失敗。
4. 證明既有 static/animated counts 與 validation 未改變。

### 目標 B — Web 尺寸處理

**Owner：Agent B**

檔案所有權：

- `web/src/webpipe/fitCanvas.ts`
- `web/src/webpipe/processStatic.ts`

交付：

1. `FitOptions` 新增 optional minimum canvas contract。
2. `ProcessStaticOptions` 可把 minimum 傳給 fit，不改既有 caller 的預設結果。
3. minimum 使用透明 padding，內容等比、置中、偶數且不超 maximum。
4. 對不可能的 min/max 組合回明確錯誤。

### 目標 C — Web UI、切割示意與 E2E

**Owner：Agent C**

檔案所有權：

- `web/src/ui/SheetTab.tsx`
- `web/src/ui/SheetCutPreview.tsx`（新增）
- `web/src/app.css`（只新增 sheet preview 樣式）
- `web/scripts/smoke.mjs`

預先約定的介面：

- Agent A 提供 `BIG_STICKER_SPEC`、`StickerKind='big'`、`maxBounds('big')`、`validatePack(kind:'big')`。
- Agent B 提供 `processStatic(..., { minCanvas?: Bounds, marginPx?: number })`。

交付：

1. Sheet 規格選擇：`一般靜態貼圖`／`大貼圖`。
2. Big 模式傳 `bounds=396×660`、`minCanvas=80×524`、`marginPx=0`、`maxBytes=1 MB`、validation kind `big`。
3. 上傳後、處理前顯示格線與編號；多張 sheet、最後一張不足滿格皆正確。
4. Smoke 驗證一般 4×2 preview 有 8 格、圖片與 SVG bounds 對齊；一般靜態仍通過。
5. Smoke 切到 Big 模式，以同一合成 sheet 產出 8 張；逐張 natural size 均落在 min/max、為偶數，並顯示 validation success。

## 6. 主代理整合與文件工作

Agent 任務完成後由主代理負責：

1. 逐一檢視 diff，確認沒有跨所有權覆寫或將 Web-only 行為帶入 CLI。
2. 補上 `README.md` 的 Web 支援流程與 Big Sticker 硬性限制。
3. 更新 `ARCHITECTURE.md`：shared core 新規格、Sheet adapter 模式、minimum-canvas 行為與 nominal preview／actual gutter snapping 的差異。
4. 更新本計畫狀態、實作日期與驗證證據。
5. 檢查最強反例：寬扁內容仍需被補到高 `524px`、極窄內容仍需補到寬 `80px`，不能把內容拉伸；regular static 仍保留 10 px margin。

## 7. 驗證策略

### Shared core

```bash
npm run typecheck
npm test
npm run build
```

必要斷言：

- `allowedCounts('big')` 僅接受 8/16/24/32/40。
- Big sticker 的四個尺寸邊界、偶數、alpha 與 bytes 錯誤 code 穩定。
- `validatePack(kind:'big')` 仍檢查 main/tab/ZIP。

### Web build

```bash
cd web
npm run typecheck
npm run build
```

### Browser E2E

Terminal A：

```bash
cd web
npm run preview -- --port 4179
```

Terminal B：

```bash
cd web
node scripts/smoke.mjs http://127.0.0.1:4179/
```

必要觀察：

- 選取 `sheet_green_4x2.png` 後，不按「切格並打包」也能看到 8 格 overlay。
- `<img>` 與 `<svg>` 的 rendered `left/top/width/height` 一致，容許小於 1 px 的瀏覽器浮點誤差。
- 一般靜態產物仍 ≤ `370×320` 且通過。
- Big 產物 8 張皆在 `80–396 × 524–660`、偶數、≤ 1 MB、透明 PNG，main/tab 與 ZIP validation 通過。
- 切換 count/grid 後 preview 即時更新，不殘留已 revoke URL 或 console error。

## 8. 驗收條件

- [x] `組圖切格` 可在同一分頁選一般靜態或 Big Sticker。
- [x] Big Sticker 所有硬性像素、檔案、張數、main/tab、ZIP 限制均由 shared validator 檢查；Web 成品另提供透明與前景像素證據。
- [x] Big 模式不主動加入 10 px margin，內容不被非等比拉伸。
- [x] 一般靜態模式行為與輸出規格不變。
- [x] 選檔後、執行前可見精確對齊圖片 bounds 的 nominal grid 與 row-major 編號。
- [x] UI 明示正式切格可能依透明 gutter 微調，避免把示意誤當最終 pixel cut。
- [x] Root typecheck/test/build、Web typecheck/build、Browser smoke 全部通過。
- [x] README、ARCHITECTURE 與實作一致；不宣稱工具能保證 LINE 審核通過。

## 9. 風險與非保證

- LINE 官方的「太長導致辨識度差」是內容建議，不是本工具可客觀驗證的 metadata 規則。
- DPI metadata 在目前 browser encoder 中不是受控欄位；本版只保證官方 pixel dimensions 與 RGB/RGBA PNG 流程。
- nominal preview 不執行背景分析；真正的 `cutSheet` 仍可能把線吸附到附近透明 gutter。兩者差異是刻意設計，會在 UI caption 說明。
- validation success 是診斷結果，不等同 LINE 審核或上傳一定成功。

## 10. 實作結果與觀察證據

- `npm run typecheck`、`npm run build` 通過；`npm test` 為 67 passed、0 failed。
- `cd web && npm run typecheck`、`npm run build` 通過。Vite 仍只回報既有的
  `coi-serviceworker.js` module 與 ONNX Runtime `eval` warnings。
- Browser smoke 在 production preview 驗證：上傳前即可見 4×2 的 8 格 overlay；`img` 與 SVG
  rendered bounds 差異小於 1 px，所有編號可見且位於自己的格內。
- 同一個 4×2 綠幕 fixture 先產一般靜態包，再產 Big Sticker 包；8 張 Big Sticker 均為
  `396×524`、偶數、通過 shared validation，且 alpha bbox 與一般模式的長寬比差異在 3% 內，
  證明 minimum canvas 使用透明 padding 而非非等比拉伸。
- 測試結束後已關閉暫時的 Vite preview；`4179` 無監聽行程。
