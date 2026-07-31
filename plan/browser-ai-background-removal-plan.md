# 瀏覽器端 BiRefNet AI 去背實驗計畫

> 2026-07-31 更新：這份文件只保留「純瀏覽器 ONNX／WASM」的研究；它不是目前實作路徑。

- 狀態：提案；尚未授權或開始實作
- 日期：2026-07-30
- 工作分支：experiment-birefnet-browser-background-removal
- 主要交付面：Web app 的「影片 → APNG」分頁
- 前置研究：[BiRefNet Lite 512 瀏覽器與手機可行性評估](../doc/birefnet-browser-mobile-feasibility.md)

## 1. 目標與明確範圍

目標是在使用者的瀏覽器中，以 BiRefNet Lite 512 對影片格子做語意去背，避免把影片上傳到服務端或支付逐次 API 費用。同時，當使用者看起來正在使用手機或平板時，清楚提示本機模型下載與逐格推論可能需要很久、耗電或失敗。

本計畫採用的範圍解讀是：先只處理「影片 → APNG」工作流。這份計畫不會替換 Build、Sheet 或 Anim 分頁目前的 IMG.LY 去背，也不會變更 CLI、Node pipeline 或 src/core。理由是現有可行性資料與品質問題都針對固定網格影片，而影片 pipeline 的 master APNG 邊界正好能讓模型只執行一次。

首版產品定位是「桌面 Chrome／Edge 優先的實驗功能」。Android 可讓使用者嘗試但不宣稱支援；iPhone／iPad 不宣稱支援。手機提示是風險告知，不是瀏覽器能力判定或封鎖。只有 worker runtime spike 通過後，才可把此選項展示給一般使用者；主執行緒版本只可用於 Task 0 的本機桌面測試。

無 WebGPU 的策略明確採「使用者同意後才試 WASM」：preflight 若偵測不到 WebGPU，或第一次 WebGPU warm-up 失敗，UI 必須先顯示「將嘗試未驗證、可能很慢的 WASM fallback」並讓使用者明確選擇繼續或取消。使用者已同意後才建立 WASM session；拒絕時保留來源與設定，絕不改跑色鍵。這是 runtime fallback 的同意，不是將手機提示變成封鎖。

不在本次範圍：

- 遠端去背 API、帳號、伺服器上傳或使用量計費。
- 自動改用單色色鍵作為模型失敗的靜默 fallback。
- 取代既有 IMG.LY runtime、移除 IMG.LY，或把 BiRefNet 設為預設。
- 光流、跨幀 mask smoothing、alpha EMA、RGB decontamination、defringe。
- 正式 mobile support、預估完成分鐘數，或以 LINE validation 成功宣稱去背品質正確。

## 2. 已觀察的現況與未知項目

### 已觀察

- 影片 master 流程位於 web/src/webpipe/masterApng.ts:47。現在每個來源 frame 在 99–115 行走「整張 frame 色鍵 → 每格 crop → resize」。BiRefNet 必須只改 AI 分支為「每格 crop → 推論 → 套 alpha → resize」。
- VideoTab 的背景選項目前是 autoRemoveBackground 布林值，實際表示單色色鍵，設定 UI 位於 web/src/ui/VideoTab.tsx:664–678。AI 不能被塞進這個布林值。
- UI 目前建議最多 12 × 12 個格子與 60 個 master samples；這些 HTML max 值不是可靠的 runtime guard。若不新增程式強制限制，輸入可能要求 8,640 次推論。研究文件中的 3 × 2、10 samples 只會是 60 次。
- VideoTab 已有 AbortController、取消按鈕及文字進度；master pipeline 現有 progress 只按來源時間點，而非每一個 AI crop。
- App.tsx 同時掛載所有 tabs，而現有 IMG.LY model progress 是 module-global 單一 callback。因此新的 Video AI 進度不可直接重用 web/src/ui/modelProgress.ts。
- 已完成的 master APNG 會寫入 Project ZIP；重新匯入後由 processMasterApngSticker.ts:112 重編，且刻意以 removeBackground: false 運作。因此正常重新開啟 Project 不需要重新載入影片或模型。
- COI service worker 已提供 WASM 多執行緒所需的 cross-origin isolation 基礎，但不能證明模型能在特定裝置完成。
- web/package.json 尚未直接依賴 onnxruntime-web；目前安裝的 1.17.3 只是 IMG.LY 的 transitive dependency。
- 隔離 browser spike 已確認 fp16 ONNX 的 input 是 float32 input_image [1,3,512,512]、output 是
  float32 output_image [1,1,512,512] logits；前處理是 RGB ImageNet normalize，output 需 sigmoid
  後回縮。桌面 headless Chrome WASM 單張 crop 成功，但本 app 的 WebGPU／worker／部署路徑、手機及
  第三方權重授權仍未驗證。

### 由現況推論

- crop-first 可保留每個格子在 512 模型輸入上的有效解析度；將整張 1280 × 720 frame 先縮成 512 會明顯犧牲每格的文字與細節。
- 單一、重用的 inference session 搭配順序推論，較能控制峰值記憶體；Promise.all 併發跑所有 crops 不可接受。
- 對已寫入 master 的 alpha 再次去背既浪費，也會破壞 Project ZIP 可離線重編的設計。
- 手機 UA 只能當 UX hint。真正可用性必須以 session 建立和實際 warm-up 判斷。

### 尚未驗證，必須是導入 gate

- third-party ONNX 產物的 license、revision、轉檔來源、檔案 SHA-256 與可再現取得方式。
- WebGPU session 加上實際 warm-up 是否成功；雖然 WASM 已在桌面 headless Chrome 跑過單張 crop，
  它是否能作為完整工作與手機的可用 fallback 仍未知。
- 3 × 2 黑底影片的文字保存、邊緣色溢、跨幀閃爍、完整 60 crop 耗時與記憶體穩定性。
- worker 中的 ONNX Runtime WebGPU／WASM session 是否可穩定運作。

## 3. 動工前審視：質疑、刪除、再優化

### Step 1 — 需求審視

| 需求 | 判定 | 具體理由 |
| --- | --- | --- |
| 瀏覽器本機模型去背 | 成立但限於影片實驗路徑 | 使用者的問題是影片 frame 無法自帶透明背景；master APNG 在建立後不會重跑模型。 |
| 偵測手機後提示等待風險 | 成立 | 94 MB 權重和多次 crop 推論對 iOS／中低階 Android 是明確風險，但偵測本身不能判定成敗。 |
| 所有 web 分頁都改用 BiRefNet | 刪除 | Build、Sheet、Anim 已使用不同 pipeline；此改動會無端影響已運作的使用情境。 |
| 正式支援手機 | 刪除，待實機矩陣完成再重新提出 | iOS 沒有已確認的 WebGPU 快速路徑，Android 裝置差異尚未量測。 |
| 模型出錯時自動改色鍵並當作成功 | 刪除 | 色鍵與語意去背結果不同；靜默切換會使使用者誤以為 AI 成功。 |
| 先做 temporal smoothing、defringe 或模型替換 | 刪除 | 已驗證的只有隔離靜態 spike，不是本 app 的影片品質；這些仍是第二層問題。 |

### Step 2 — 刪除建議

- 不引入 Transformers.js。固定 ONNX 只需要直接、版本鎖定的 onnxruntime-web；多一個 pipeline abstraction 只會增加部署大小與相容性面。
- 不以螢幕寬度、pointer coarse、hover、deviceMemory 或 maxTouchPoints 封鎖手機；它們會誤判窄桌機、Surface 或外接觸控螢幕。
- 不在 spike 階段改 Project ZIP schema。alpha 已在 master pixels 中保存；只有功能被採用後，才加入 provenance 欄位並升級 schema。
- 不承諾立即取消單次 ONNX run。取消只保證當前 crop 結束後不排入下一個 crop，除非 worker 實測證實可安全終止。

### Step 3 — 優化後的最小設計

- 直接將一個 browser-only、worker-owned 的 BiRefNet adapter 放在 web/src/webpipe/。
- 保留現有影片解碼、固定裁格、master APNG 與 Project ZIP。
- UI 將背景模式改為明確 enum：none、color-key、ai-birefnet。
- 初始實驗硬上限為已實測範圍的 60 個 AI crops。這足以驗證 3 × 2 × 10，卻不承諾能處理完整 8／16／24 張包；只有完成 240 crops 的壓力測試並簽核後才可調高。

## 4. 目標架構與行為規格

背景模式的資料流必須保持互斥：

    none:
      來源 frame → crop → resize → master APNG

    color-key:
      來源 frame → 現有 keyBackground → crop → resize → master APNG

    ai-birefnet:
      來源 frame → crop 原始格子 → BiRefNet 512 → mask sigmoid／回縮
      → 將原 alpha 與模型 alpha 合成 → resize → master APNG

AI 分支不得先縮放整張來源影片，不得對同一 crop 同時跑色鍵與 BiRefNet，也不得在 processMasterApngSticker.ts 的調整階段重跑模型。

模型 adapter 的責任：

- 等使用者選擇 ai-birefnet 並按下建立 master 才 lazy-load 模型。
- 先建立 WebGPU session，並以一次實際 crop warm-up 驗證。若無 WebGPU 或第一次 warm-up 失敗，回傳需要使用者確認 WASM fallback 的狀態；只在明確確認後才釋放 WebGPU session 並建立 WASM session。
- WebGPU／WASM 都失敗時回傳可理解的 inline error，不產生 partial master，也不改用色鍵。
- 一個 master job 只建立一個 session，所有 crops 依序處理；每次 run 都釋放 input/output tensors 和暫存 buffers，job 結束或失敗時釋放 session。
- 依模型的實測契約處理 NCHW、RGB normalization、512 方形 resize、output logits、sigmoid 與回縮。這些參數在 spike 前不得憑猜測寫死。
- alpha 合成必須是相乘語意：outA = round(originalA × maskA ÷ 255)，而不是取兩者最小值。這項公式必須有單元測試，包含兩個半透明值各為 128 時輸出約為 64 的案例；不在本版改動半透明邊緣 RGB，因此不宣稱解決色溢。
- 回報 model-download、session-init、warm-up、已完成 crops／總 crops、APNG encode 等細緻狀態。若下載 response 沒有 Content-Length，只顯示下載中，不捏造百分比。
- worker 是一般使用者可見實驗功能的 hard gate；worker 無法建立時，只記錄 Task 0 的桌面 spike 結果，不開放主執行緒 fallback。

部署設計：

- 最終瀏覽器請求只能使用同源、版本化的模型與 WASM 路徑，例如 models/birefnet-lite-512/REVISION/。
- 不把使用者 runtime 建立成向 Hugging Face 即時抓取的依賴。
- 約 94 MB 的模型檔不應在未決定 repo／release／CI 資產策略前直接提交。導入 gate 必須先決定如何由可驗證的 artifact 放進 GitHub Pages deploy 產物，以及如何保存 attribution。
- onnxruntime-web 必須改為 web/package.json 的 direct、鎖定版本 dependency；不可依賴 IMG.LY transitively hoist 的版本。Vite 必須複製該版本的完整 ORT WASM／worker assets 到固定同源目錄，adapter 以 document.baseURI 或 worker location 解析該目錄，不能假設網站部署在網域根目錄。

## 5. 分階段實作任務

### Task 0 — 資產、授權與 runtime 相容性 spike

影響範圍：暫存 spike；成功前不改變正式影片 UI。

工作內容：

1. 取得 Lite 512 的可驗證模型 artifact，記錄模型卡、license、revision、轉檔者資訊、完整 SHA-256、input/output metadata 與檔案大小。上游 BiRefNet 的 MIT 不能單獨視為第三方 ONNX 產物已授權。
2. 選擇一個 direct onnxruntime-web 版本並鎖入 web/package.json 與 web/package-lock.json；不要使用目前 IMG.LY 間接帶入的版本。
3. 對模型、onnxruntime-web 與其 WASM／worker assets 全部完成 attribution／license audit；將固定 hash 的驗證做成 build／CI 失敗條件，而不只是手動紀錄。
4. 在桌面 Chrome／Edge 建立最小 browser spike，對一個約 427 × 360 crop 實跑 WebGPU session、實際 warm-up 和輸出處理；只有確實成功才叫作 fast path。
5. 驗證無 WebGPU 或 WebGPU 初始化／warm-up 失敗時，UI 會先要求 WASM consent，之後才建立新 WASM session；兩者失敗時記錄原始錯誤分類。
6. 以同一個範例確認 worker 是否能擁有 session。如果 worker 不可用，主執行緒版本只能被標為本機桌面 spike，不能直接升格成對外實驗功能。
7. 決定模型 artifact 的 deployment 方式。候選方案必須讓 CI 或已驗證來源把 hash 相符的模型和 ORT assets 放進 web/dist，而非讓訪客在 runtime 向不受版本控制的第三方 URL 下載。
8. 產生一份不在 source tree 承諾效能的 spike result table，列出 60 crops 的完整耗時、單 crop p50／p95、取消等待、deploy bytes、worker UI responsiveness、ROI／golden-mask 判定和文字／裝飾 false-negative。產品 owner 必須在 Task 3 前填入每一列的通過門檻；沒有簽核門檻不能升格功能。

通過條件：

- 已能指出完整的模型來源與授權，不存在「只知道上游 MIT」的缺口。
- 一個真實 crop 輸出形狀、數值範圍與 alpha mask 可被檢查；沒有 NaN、尺寸錯誤或全為無效值。
- WebGPU 和 WASM 的結果、失敗原因及 selected provider 均可區分。
- worker 能在 production-shaped 站點路徑中載入同源 ORT assets，且 service worker 後的 crossOriginIsolated 狀態可觀察。
- 60 crop 結果表已建立；若要提高上限至 240，另需完成 240 crop 的桌面 OOM、取消與 UI responsiveness 壓力測試並更新簽核門檻。
- 未通過任一項時停止在 spike，移除暫存產物或留在 ignored tmp；不開始產品整合。

### Task 1 — 建立獨立的 browser BiRefNet adapter

預計檔案：

- 新增 web/src/webpipe/birefnet.ts
- 新增 web/src/webpipe/birefnet-worker.ts 與 worker client entry
- 視需要新增 web/src/webpipe/backgroundMode.ts 或在 masterApng.ts 定義小型 adapter interface
- web/package.json、web/package-lock.json、web/vite.config.ts
- 模型與 ORT asset staging／deploy 設定，位置待 Task 0 決定
- 視 deployment 選擇更新 .github/workflows/deploy-pages.yml

工作內容：

1. 實作 createBiRefNetRemover 之類的明確 API，由呼叫端傳入每次 job 的 status callback；不要接到既有 removeBackground.ts 的 module-global progress callback。BiRefNet code 與模型 artifact 皆需只在 AI mode 動態載入。
2. 將 adapter 設計成可注入 fake remover，讓 master 路由可驗證 crop 順序、計數和取消，而不需每次下載真模型。
3. 在 worker 實作以真實模型契約為準的 preprocessing、session.run、sigmoid、mask resize 和原 alpha 相乘合成；主執行緒只傳遞一個 crop、接收一個結果並更新 UI。
4. 對不合理輸出做基本 sanity check：shape 或有限數值錯誤必須失敗；極端前景比例只記錄警告，不能在沒有真實素材基準時武斷當作錯誤。
5. 每個 tensor／buffer 都在 finally 中釋放，讓 session 生命周期只覆蓋一個 master job。
6. 將 direct ORT package 的完整 WASM／worker asset set 由 Vite 複製到固定 dist 路徑，設定 wasmPaths／等效 runtime path，並在 Pages 子路徑、COI service worker 重載後驗證請求均為 200。

驗收：

- non-AI 模式不動態載入 BiRefNet code、不 fetch 模型 asset、也不初始化 ORT session。
- 真模型與 fake remover 都可透過相同的 adapter contract 回報狀態。
- 已測出同時在飛的推論數永遠為 1。
- worker 缺失或失敗時，UI 不公開 AI run button；本機 spike 可顯示其錯誤但不可偷偷退回主執行緒。

### Task 2 — 將 crop-first 路徑接入 master APNG

預計檔案：

- web/src/webpipe/masterApng.ts:47–125
- 視需要 web/src/webpipe/raster.ts，僅新增 browser raster 的 alpha mask 合成工具
- 不修改 src/core/videoCrop.ts 或 processMasterApngSticker.ts

工作內容：

1. 將 autoRemoveBackground 改成語意明確的背景模式和必要參數。保留 color-key 的既有行為與輸出順序。
2. AI 模式中先從未色鍵的來源 frame crop，再將單一 crop 交給 adapter，最後 resize 至既有 animated canvas。
3. 用實際 timestamps 數量計算 totalCrops = grid.count × timestampsMs.length；不以 UI 尚未去重的 masterFrames 值當最終真相。
4. 在任何 model download、session 初始化或影片 frame decode 前，以已驗證的 gridPlan 與 planSampleTimestamps 算出 totalCrops。若 totalCrops 大於 60，立即顯示可理解錯誤，不碰模型或來源 frame；提高到 240 前必須走 Task 0 的壓力測試與簽核。
5. 依序處理每個 crop，於每個 crop 結束後檢查 AbortSignal 並讓回 UI／worker message loop。取消後不開始下一個 crop，並丟棄未完成的 master 結果。
6. 將 progress 改為結構化事件，至少區分模型下載、初始化、AI crops、master chunk encode 和 baseline render。不要沿用 IMG.LY 全域 callback。

驗收：

- 假 remover 的呼叫數精確等於 grid.count × timestampsMs.length，且每次收到的是單一 crop，而不是完整來源 frame。
- totalCrops guard 在模型下載、session 初始化和 frameAt 前觸發，且 3 × 2 × 10 以外的 61+ 組合不能繞過。
- none 與 color-key 路徑的既有 video smoke 行為不變。
- cancel 在目前 crop 結束後停止，不會再排入新的 crop。
- Project ZIP 重匯後只讀既有 master／render，不請求模型。

### Task 3 — VideoTab 選項、手機風險提示與可及性

預計檔案：

- web/src/ui/VideoTab.tsx:268–420、615–687
- 新增 web/src/ui/deviceHints.ts
- web/src/app.css
- 視需要新增專用的 Video AI progress UI helper；不修改 modelProgress.ts 的全域 IMG.LY 行為

工作內容：

1. 將「單色色鍵去背」布林控制改成可理解的 select 或 radio group：

   - 不去背
   - 單色色鍵
   - AI 去背（實驗）

   預設仍為不去背；AI 與色鍵不可同時勾選。

2. loadVideo 載入新影片時必須把背景模式重設為 none，和目前重設色鍵／選色的行為一致；避免上一支影片意外保留 AI mode、警告或 fallback consent。
3. deviceHints.ts 僅提供 UI hint，並接受可注入的 navigator-like snapshot，避免全域 DOM augmentation。回傳 phone、tablet 或 unknown：

   - phone：navigator.userAgentData.mobile 明確為 true；只有 userAgentData 不存在時才用 iPhone、iPod、Android.*Mobile、Windows Phone、IEMobile、Opera Mini 等狹窄 UA fallback。
   - tablet：iPad UA、MacIntel 加 maxTouchPoints 大於 1 的 iPadOS heuristic，或沒有 Mobile token 的 Android UA。
   - unknown：明確 desktop UA-CH false 或其他情況。UA-CH 明確為 false 時不得讓 UA fallback 推翻它。

4. 不用螢幕寬度、pointer coarse、hover、deviceMemory 或 maxTouchPoints 判定 phone。maxTouchPoints 只在上述 iPadOS tablet heuristic 使用，仍不得封鎖功能。
5. 使用者選到 AI 模式時，所有裝置都顯示「首次使用時可能需下載大型模型；目前設定會每一個貼圖格、每一個時間點各跑一次」的 inline notice。只有 gridPlan 與預先規劃 timestamps 都有效時，才顯示精確 N = gridPlan.rects.length × plannedTimestamps.length；否則顯示「設定完成後計算」。
6. 若 deviceHints 回傳 phone 或 tablet，顯示緊鄰 AI 控制項且不阻擋的提示，文案採以下意思：

   > 行動裝置提醒：目前設定需要執行 N 次 AI 去背。這可能花很久、耗電，或因記憶體不足而停止；建議使用桌面版 Chrome／Edge。你仍可繼續。

   N 來自有效 grid 與 timestamps，按下建立 master 後沿用同一個實際 totalCrops。不要在沒有量測資料前寫「約 X 分鐘」。這個行動裝置提示不需要確認；無 WebGPU 時的 WASM consent 是所有裝置一體適用、獨立的 runtime safety gate。

7. AI 選項以 aria-describedby 關聯 notice；notice 使用 role=status 和 aria-live=polite。開始處理後必須依序顯示下載／初始化、AI 去背 n／total、master encode、baseline render。取消旁需說明「會在目前一格推論結束後停止」。
8. 在 VideoTab 建立可清除的 inline error state。preflight、模型、OOM／device loss 或 fallback 失敗時，保留已載入 source、背景模式與格線設定，讓使用者能改成 none／color-key 或重試；新影片載入、模式變更和新一次成功 run 都應清除舊錯誤。log 不能是唯一錯誤表面。

驗收：

- 手機 hint 只改變提示，AI 按鈕仍可由使用者選擇；實際能力仍以 session warm-up 決定。
- 窄桌機、Windows 觸控桌機不會因 heuristic 被當成 phone。
- iPhone UA、Android Mobile UA、iPad desktop-UA 和 Android tablet 都有測試案例。
- UA-CH false 不會被 UA fallback 覆寫；沒有有效 grid／timestamps 時不顯示錯誤的 N。
- 無 WebGPU 時，只有明確接受 WASM consent 才會嘗試 WASM；拒絕後仍保留來源並能選擇其他背景模式。
- 新影片會重設為 none，模型錯誤能在 inline UI 清除並重試。
- 由於全部 tabs 常駐掛載，隱藏分頁的 IMG.LY progress 不會覆寫 Video AI job 的狀態。

### Task 4 — Provenance、文件與提高工作量上限，只在 spike 通過後進行

預計檔案：

- web/src/webpipe/masterApng.ts、web/src/ui/VideoTab.tsx
- 若保留 feature，再更新 web/src/webpipe/videoProjectZip.ts 及 schema migration／tests
- README.md、web/README.md、ARCHITECTURE.md

工作內容：

1. worker 已在 Task 0／1 是可見功能 hard gate；若 worker 失敗，保留本機 spike 結果但不加入主執行緒 desktop fallback。只有在 worker 路徑實際通過時才繼續本 task。
2. 若 feature 被採用，將 background mode、模型 ID、revision、SHA、selected provider 和失敗／fallback 狀態寫入 Project manifest 作為 provenance。這需要明確 schema version bump、import migration 和 round-trip fixture；不得默改 v1。
3. 若要把 safety limit 從 60 提到 240，先完成完整 240 crop 的桌面壓力測試，並由 product owner 在 result table 簽核完整等待時間、取消延遲、UI responsiveness、OOM／device loss、deploy bytes 與 ROI 品質門檻。未簽核即維持 60。
4. 只在採用後更新 README.md 的瀏覽器去背／影片行為、web/README.md 的 AI 風險和部署說明，以及 ARCHITECTURE.md 的 browser adapter 邊界與資產部署行為。

## 6. 測試與量測策略

### 自動化測試

- 新增 web/scripts/device-hints.test.mts，並在 web/package.json 定義 test:ai。deviceHints 的純函式以注入 snapshot 測試 UA-CH mobile true／false、Safari iPhone fallback、Android Mobile、Android tablet、iPad desktop-UA、窄桌機、Windows 觸控桌機；不需 browser global。
- master routing 的 fake remover 測試：驗證 crop-first、單一 in-flight inference、精確計數、AbortSignal、原 alpha 保留和 non-AI 路徑不呼叫模型。
- 擴充 web/scripts/video-smoke.mjs：保留 none／color-key regression，新增受控 fake model 或實驗專用測試，確認 Project ZIP round-trip 不重跑模型。
- 擴充 web/scripts/mobile-check.mjs：納入「影片 → APNG」分頁，於 iPhone Chromium UA／viewport 模擬驗證提示、按鈕可繼續使用和零水平溢出，並以控制的 navigator snapshot 覆蓋 UA-CH 與 UA fallback 路徑。這只能驗 UI，絕不可當 iOS Safari、WebGPU、WASM 或效能證據。
- 實際模型 browser smoke：桌面 Chrome／Edge 量 cold download、warm-up、單 crop p50／p95、60 crops 總時間、provider、錯誤與 UI responsiveness，以及同源 ORT asset 在 Pages-shaped 子路徑載入後不出現 404。

### 人工 A/B 與真機矩陣

使用有權利測試的真實 3 × 2 黑底影片，對每一個 6 × 10 crop 比較：

1. 不去背。
2. 現有單色色鍵。
3. BiRefNet Lite 512。

逐一檢查黑髮、眼睛、衣物、分離文字、裝飾、內部孔洞、黑邊／色溢與最終 APNG 的幀間閃爍。至少建立一個人工標記的 golden mask 或 ROI；否則只能作主觀 A/B，不得宣稱量化品質改善。測試產物留在 eval、spike 或 tmp 等 local/generated 位置，不寫入 source 文件。

手機實機至少涵蓋：

- 近期高階 Android Chrome。
- 中階 Android Chrome。
- 近期 iPhone Safari。
- 較舊 iPhone 或 iPad。

每台分別記錄 cold／warm 模型、warm-up、單 crop p50／p95、完整工作耗時、OOM／device loss、頁面重載、取消與重試結果。

### 每次實作後的必要檢查

    npm run typecheck
    npm test
    npm run build

    cd web
    npm run build
    npm run test:ai
    npm run test:video
    npm run preview -- --port 4179

另開一個終端：

    cd web
    node scripts/smoke.mjs http://127.0.0.1:4179/
    node scripts/video-smoke.mjs http://127.0.0.1:4179/
    node scripts/mobile-check.mjs http://127.0.0.1:4179/

若本機缺少 ignored fixture、Playwright browser 或真實模型資產，報告必須明確標示未驗證項目，不能將 build 通過說成模型已可用。

## 7. Go／No-Go 決策

只在以下條件都成立時，才將 feature 從 spike 提升為可見的實驗性選項：

- 模型、onnxruntime-web、WASM／worker assets 的授權、revision、hash 與同源部署方式可重現，且 CI 對缺檔或 hash 不符失敗。
- Task 0 的 60 crop result table 已由 product owner 填入並簽核所有數值門檻：完整 job 等待、單 crop p95、取消等待、deploy bytes、UI responsiveness、ROI／golden-mask、文字／裝飾 false-negative。
- 桌面 Chrome／Edge 的 3 × 2 × 10 實跑符合已簽核門檻，且無 OOM、device loss 或頁面重載。
- worker 路徑在 production-shaped URL 與 COI service worker 後通過；沒有可見功能的主執行緒 fallback。
- AI 路徑沒有改壞 none／color-key regression，且 Project ZIP 匯入不重跑模型。
- 60 個 crop 的人工 A/B 符合已簽核的 ROI／文字／裝飾門檻；最終 APNG 的閃爍也符合結果表規則。若不符合，先記錄為模型限制，不在同一輪塞入 smoothing。
- 手機仍維持「可嘗試、未支援」的文案，直到真機矩陣有足夠證據。

以下任一項即為 No-Go 或回到 spike：

- 第三方 ONNX 授權或可重現來源不能確認。
- WebGPU 與 WASM 都無法在目標桌面環境穩定完成。
- worker 無法工作；此時主執行緒只可留下本機 spike，不得成為產品 fallback。
- 94 MB 權重、ORT runtime 或相關部署成本超過已簽核門檻。
- A/B 或動畫穩定性未通過已簽核的品質規則。

## 8. 已刻意反駁過的結論

「模型作者在 M1 MacBook Pro 成功」不足以證明本 app、GitHub Pages、真實影片或任何手機可用；其中任何一項都可能在模型啟動、資產載入、GPU buffer、品質或跨幀穩定性上失敗。

同樣地，「提示手機可能很久」不是手機支援策略。它只能避免意外期待，不能代替實機量測或模型 warm-up。若本計畫的 Task 0 或 A/B gate 未通過，最正確的結果是保留現有單色色鍵流程，而不是勉強把 BiRefNet 加入產品。
