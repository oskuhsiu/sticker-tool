# 影片組圖裁切為 LINE 動態貼圖的實作計畫

- 狀態：MVP 已實作（2026-07-29）
- 日期：2026-07-29
- 主要交付面：Web app（互動式編輯）
- 共用影響：`src/core/` 的時間軸、動畫結果契約與驗證，以及 Node/Web 兩套 APNG pipeline

目前交付涵蓋固定等分網格、時間取樣、分段 master APNG、逐張時間/格數/播放/減色調整、
baseline/current、LINE ZIP、Project ZIP round-trip、最終像素與時間證據，以及影片 E2E。
計畫中的拖曳個別 crop、逐 frame offset、WebCodecs container demux、worker 化與 24 張專項
memory profiling 尚未納入本次 MVP；目前影片 adapter 使用瀏覽器 media element 依時間點 seek。

## 1. 功能摘要

新增一個「影片組圖 → 多張動態貼圖」工作流。輸入是一段影片；影片的每一個時間畫格都是一張固定版面的「大圖」，大圖中的每個空間區域對應一張小型動態貼圖。

使用者可以：

- 上傳影片，在代表畫格上設定網格或個別裁切框。
- 設定全域起訖時間，例如 `1.2s–5.8s`，並可逐張覆寫。
- 選擇合法的 LINE 單輪播放時間與循環次數。
- 由工具依實際影片時間戳，自動把來源畫格降至 LINE 允許的 5–20 格；若仍超過 1 MB，再依品質階梯減色或減格。
- 第一次裁切後，先建立每張貼圖的可編輯 master APNG；後續調整直接解開 master APNG 做 frame-to-frame 編輯，不再反覆解碼影片。
- 比較第一次自動裁切的「原始結果」與目前的「調整結果」。
- 查看每張貼圖的裁切、時間、抽格、延遲、壓縮、尺寸、透明度與驗證資料。
- 下載 LINE 上架 ZIP。
- 下載可重新匯入的 editable project ZIP；其中包含 master APNG、原始/調整結果與 manifest，重新上傳後不需要原影片即可恢復調整模式。

首版不把影片上傳到伺服器，也不呼叫影像生成服務。影片解析、裁切、APNG、ZIP 與重新匯入全部在瀏覽器本機完成。

## 2. 已觀察到的現況

以下是目前 source 已存在的行為，不是本計畫的假設：

- Web 的動畫工作流只有「一張 frames-sheet → 一段 APNG」與「每張貼圖各自上傳一組 frame files」兩種模式：`web/src/ui/AnimTab.tsx:25-42`。
- 共用檔案選取元件只接受 `image/*`：`web/src/ui/common.tsx:82-125`。
- Web 目前會在 frame 超過 20 時先做等索引抽樣，之後 auto-fit 還可能再次減格：`web/src/webpipe/processAnimated.ts:46-53`、`web/src/webpipe/apng.ts:170-191`。
- 現有 encoder 只接受單一平均 `delayMs`，每格獨立四捨五入，無法精確表達 VFR 影片，也無法保證總延遲剛好是 1/2/3/4 秒：`src/pipeline/apng.ts:46-56`、`web/src/webpipe/apng.ts:52-61`。
- `ProcessedAnimated.fittedFrames` 是減格前的 frame，而不是成品實際使用的 frame：`src/pipeline/processAnimated.ts:114-127`、`web/src/webpipe/processAnimated.ts:112-124`。
- 動態 `main.png` 會重新從全域 animation config 推導時間，而不是沿用封面貼圖的成品時間軸：`src/package/buildMainTab.ts:67-102`、`web/src/webpipe/mainTab.ts:49-80`。
- 現有 ZIP 只有 LINE 上架檔，沒有 manifest、來源素材或可重新匯入的調整狀態：`src/package/buildZip.ts:35-61`、`web/src/webpipe/zip.ts:21-32`。
- Web 的手動排版會把 offset 直接烙進新 frames，沒有把 offset 當成可序列化的編輯資料保存：`web/src/ui/ManualLayout.tsx:92-113`。
- `plan/implementation-audit.md` 已確認動畫時間、相同畫格、最終 frame 契約、main 同步、驗證與下載語意等缺口。影片功能不得建立在這些缺口仍未處理的情況上。

## 3. LINE 規則基準

2026-07-29 再次核對官方文件：

- 動態貼圖包只能有 8、16 或 24 張。
- 每張為 APNG，尺寸不超過 320×270，且寬或高至少一邊達 270 px。
- 每個 APNG 為 5–20 格、1–4 loops，單輪播放時間只能是 1、2、3、4 秒，且 `單輪時間 × loops <= 4 秒`。
- 每張圖片不超過 1 MB，整包 ZIP 不超過 60 MB。
- 輸出使用 RGB/RGBA PNG/APNG、偶數尺寸且背景透明；所有畫格相同會造成上傳錯誤。
- 第一格必須能在靜態顯示時表達貼圖意涵。

來源：

- [Animated sticker requirements](https://creator.line.me/en/guideline/animationsticker/)
- [Frame, playback, and loop details](https://creator.line.me/en/guideline/animationsticker/detail/)

LINE 常數仍放在 `src/core/spec.ts`。影片工作流自己的記憶體、專案 ZIP 或解碼限制不可混入 LINE 規格常數。

音訊決策：

- 官方 Creators Market 動態貼圖規格只列 APNG sticker images、APNG main image 與 PNG chat thumbnail，沒有音檔欄位。
- LINE Help 將 voice/sound stickers 列在官方貼圖商品中，與 Creators Market 的一般動態貼圖流程不同。因此本功能不建立或上傳音訊檔；若來源影片含音軌，只在 probe 資料中標示後忽略。
- 參考：[LINE animated sticker image requirements](https://creator.line.me/en/guideline/animationsticker/)、[LINE Help 對 voice/sound stickers 的商品分類](https://help2.line.me/line/smartphone/sp?contentId=200002278&lang=en)。

## 4. 需求解讀與首版邊界

### 4.1 明確採用的解讀

- 「影片是一張大圖」解讀為：影片的每個 presentation frame 都有相同的空間版面；第 N 個裁切區在整段影片中都對應同一張貼圖。
- 空間裁切框固定套用到所有時間畫格。不得逐 frame 重新偵測元件並重新置中，否則會製造抖動或消除真正的位移。
- 影片可長於四秒。使用者選取的來源區間可以長於四秒；工具將它映射到合法的 1/2/3/4 秒輸出時間，並明確顯示速度倍率。
- 「原切好的圖」定義為每張貼圖第一次成功自動處理的 immutable baseline APNG。
- 「調整好的圖」定義為使用者目前參數產生的 current APNG。
- 第一次影片處理會先建立不受 LINE 20 格/1 MB 限制的內部 master APNG。baseline/current 都由 master APNG 產生，而不是每次回頭讀影片。
- 「同包上傳」指 editable project ZIP，不是 LINE 上架 ZIP。兩者必須使用不同名稱與按鈕，避免使用者誤把無 manifest 的 LINE ZIP 當專案檔。

### 4.2 首版支援

- Web app 的互動式影片工作流。
- MP4/MOV/WebM 等容器可被媒體解析器讀取，但實際 codec 必須通過瀏覽器 `VideoDecoder` 能力檢查。
- 固定網格、拖曳格線、個別 crop rect 微調、排序及啟用/停用格子。
- 全域時間區間與逐張 override。
- 固定背景色／綠幕色鍵去背；影片本身已有 alpha 時保留 alpha。
- 影片 → 固定 crop → master APNG；master 過長時拆成有連續時間軸的 APNG chunks。
- 重新匯入 project ZIP 後，以 master APNG 作為唯一調整來源，不要求該裝置能解碼原影片 codec。
- 自動 frame planning、手動指定目標 5–20 格、逐張 rerender。
- editable project ZIP round trip 與 LINE pack ZIP。

### 4.3 首版不支援

- 音訊處理。Creators Market 的一般動態貼圖上傳規格只有 APNG/main/tab，沒有音訊 sidecar；來源影片音軌直接忽略。
- 物件追蹤、每格不同 crop rect、鏡頭運動補償或 AI segmentation。
- 對任意複雜實景背景逐 frame 跑語意去背。這會過慢且容易閃爍；首版應要求 alpha 或固定色背景。
- CLI 直接解碼影片。互動式時間軸與裁切是 Web-only adapter；共用時間軸與 APNG correctness 修正仍需同步 Node/Web。
- 把 ffmpeg.wasm 當成靜默 fallback。codec 不支援時必須顯示精確錯誤，不可得到不完整或近似的結果。

## 5. 架構決策

### 5.1 解碼：WebCodecs + 媒體 demux adapter

首選方案是在 Web worker 中使用 WebCodecs，並以 `mediabunny` 一類能提供容器解析、實際 presentation timestamp、rotation/display dimensions 與 sparse frame access 的 adapter 接入。

實作前先做相容性 spike，通過後才鎖版本到 `web/package.json` 與 lockfile。adapter 必須滿足：

- `Blob/File` 本機來源，不需整檔複製成 `ArrayBuffer`。
- 取得 duration、codec、coded/display size、rotation、pixel aspect ratio、第一個 timestamp。
- 在指定 timestamps 依 presentation order 取得 frame，並回報實際取得的 timestamp/duration。
- 能在 worker 使用 `VideoFrame`/`OffscreenCanvas`，每格處理完立即 release。
- 可以中止長流程。

未採用方案：

- `<video>` + Canvas seek：適合播放與粗略預覽，但 seek 不保證 frame-accurate，VFR 時也不能可靠建立可重現的抽格報告。
- ffmpeg.wasm：格式較廣，但首屏下載、WASM 記憶體與長影片處理成本過高；可作後續選配，不進 MVP。
- 逐格完整解碼後全部保存在 React state：24×20×320×270 RGBA 已約 166 MiB，尚未包含來源大 frame、APNG encoder 與副本，不可採用。

### 5.2 時間：全部以整數毫秒與來源 presentation timestamps 表示

- Manifest 與 shared core 使用整數 `startMs/endMs/timestampMs/delayMs`。
- UI 可以顯示一位或三位小數秒，但不得用浮點秒當持久化真相。
- 不從平均 FPS 推算來源 frame；VFR 也要依 presentation timestamps 規劃。
- 單輪輸出時間型別改成 `1 | 2 | 3 | 4` 秒。
- 每格 delays 可不相同，但加總必須精確等於合法的單輪毫秒數。

### 5.3 空間：固定 crop rect，不沿用 component-aware animation sheet alignment

`src/core/cells.ts` 的 component assignment 適合一張靜態 sheet 或已排好的 frame-sheet，但影片中逐 frame 重新分配 component 會改變座標。影片模式改用：

1. 在一個代表 frame 上建立固定 rect。
2. rect 以「套用 rotation 後的 display pixel coordinates」儲存。
3. 每個來源 frame 使用相同 rect。
4. 只有使用者明確設定的 per-frame manual offset 能改變相對位置。

### 5.4 中介格式：影片只負責產生 master APNG

工作流拆成兩個明確階段：

1. Ingest：影片 decode → 固定空間 crop → 去背 → master APNG chunks。
2. Edit：master APNG decode → 選 x.x–y.y 秒 → 選/刪/位移 frames → LINE APNG。

master APNG 是內部可編輯素材，不是 LINE 成品：

- 可超過 20 frames 與 1 MB。
- 保存每格原始 delay，manifest 另存來源絕對 timestamp。
- 「調整 APNG」不是直接修改壓縮資料；worker 只解碼與選定時間窗相交的 chunks 為逐格像素，完成選格、offset、canvas 與 delay 調整後再編碼。
- 長片不做成一個巨型 APNG；依時間或 frame/memory budget 拆成連續 chunks，例如 `master/01/chunk_000.png`。
- chunk boundary 不可造成 frame 遺失或重複；累積 delays 必須還原完整 master timeline。
- 預設保存使用者選定的「可編輯時間窗」。超出該窗的時間在重新匯入後無法恢復，除非重新選原影片。
- 為容許少量位置/canvas 調整，master crop 可保存明確的 overscan padding；不能宣稱可在沒有原影片時重新設計整個 grid。

這個分層讓 adjustment mode 只依賴既有 APNG decoder，避免每次改一個數值就重新 demux/decode 影片，也讓 project ZIP 在其他支援 APNG 的瀏覽器中仍可編輯。

### 5.5 輸出：LINE ZIP 與 editable project ZIP 分離

- LINE ZIP：只有 `main.png`、`tab.png`、`01.png...`，沿用既有 naming。
- Project ZIP：包含版本化 manifest、master APNG chunks、baseline/current APNG、報告與 main/tab。它不是上架包。
- Project ZIP 預設不嵌入原始影片；重新上傳後可在已保存的 master 時間窗與 overscan 範圍內繼續調整。
- 若產品後續需要「任意重新畫 grid／取回 master 時間窗外內容」，再提供可選的 full-source project；不能把原影片列為一般 APNG 調整的必要依賴。
- master、baseline 與 current APNG 都已壓縮，專案 ZIP 應串流產生，不可沿用 `zipSync` 一次複製整包。

## 6. 目標資料流

```text
Upload video or editable project ZIP
  -> [video only] probe container/codec/timeline/display geometry
  -> [video only] define fixed grid/crop rects + editable time window
  -> [video only] sequential decode, fixed crop, alpha/chroma key
  -> [video only] encode per-sticker master APNG chunks
  -> [video or project] load master APNG timelines
  -> set global/per-sticker start/end + legal playback/loop/frame policy
  -> decode only master chunks intersecting the requested range
  -> select/drop/offset frames while preserving master delays
  -> shared sequence canvas plan
  -> exact LINE delay allocation
  -> encode current APNG + byte/frame/color auto-fit
  -> decode final APNG metadata/pixels and validate
  -> baseline/current comparison and reports
  -> build LINE ZIP and editable project ZIP
```

## 7. 共用資料契約

新增 `src/core/animationTimeline.ts`，保持平台中立：

```ts
type LegalPlaybackSec = 1 | 2 | 3 | 4;

interface TimelineRequest {
  startMs: number;
  endMs: number;
  playbackSec: LegalPlaybackSec;
  loops: 1 | 2 | 3 | 4;
  targetFrames: number; // 5..20
}

interface TimelinePlan {
  requestedRangeMs: { start: number; end: number };
  sourceTimestampsMs: number[];
  selectedSourceIndices: number[];
  selectedTimestampsMs: number[];
  delaysMs: number[];
  sourceSpanMs: number;
  playbackMs: number;
  speedRatio: number;
  droppedFrames: number;
}
```

核心不接觸 `VideoFrame`、Canvas、File、Blob 或 DOM。adapter 提供可用 timestamp，core 只做：

- 輸入範圍與合法組合驗證。
- 依時間等距選取，保留首尾、去除重複實際 timestamp。
- 少於五個 unique frames 時給可操作錯誤。
- 依來源 frame intervals 比例分配 delays。
- 用 largest-remainder 類型的整數分配確保 delays 總和精確。
- auto-fit 再減格時合併被移除 frame 的時間，不丟失總播放時間。

新增 `src/core/videoProject.ts`：

```ts
interface VideoProjectV1 {
  format: 'sticker-tool-video-project';
  schemaVersion: 1;
  projectId: string;
  createdAt: string;
  updatedAt: string;
  source: VideoSourceManifest;
  layout: VideoLayoutManifest;
  globalSettings: VideoRenderSettings;
  stickers: VideoStickerState[];
  coverStickerId: string;
  outputs: ProjectOutputIndex;
}

interface VideoStickerState {
  id: string;
  order: number;
  label: string;
  crop: PixelRect;
  master: MasterApngTimeline;
  baseline: RenderSnapshot;
  current: RenderSnapshot;
}

interface MasterApngTimeline {
  editableRangeMs: { start: number; end: number };
  overscanPx: number;
  chunks: MasterApngChunk[];
  sourceFrameCount: number;
  masterFrameCount: number;
}

interface MasterApngChunk {
  entry: string;
  startMs: number;
  endMs: number;
  frameTimestampsMs: number[];
  delaysMs: number[];
}

interface RenderSnapshot {
  settings: VideoRenderSettings;
  result: RenderMetrics;
  apngEntry: string;
}
```

規則：

- `baseline` 第一次成功建立後不可被一般編輯覆寫。
- `current` 每次成功 rerender 才原子替換；失敗時保留上一個 current。
- `master` 是 adjustment mode 的不可變來源；調整只產生新的 snapshot，不覆寫 master chunks。
- 匯入專案時先顯示保存的 APNG，不主動用新版 encoder 重算。
- 使用者改參數後才以目前版本 rerender，並在報告保留 encoder/app version。

## 8. Editable project ZIP 格式

首版格式：

```text
sticker-project.json
master/01/chunk_000.png
master/01/chunk_001.png
master/02/chunk_000.png
...
renders/original/01.png
renders/original/02.png
...
renders/adjusted/01.png
renders/adjusted/02.png
...
derived/main.png
derived/tab.png
reports/render-report.json
reports/validation.json
```

Manifest 至少保存：

- source 原檔名、MIME、bytes、container、codec、duration、第一個 timestamp、coded/display dimensions、rotation、pixel aspect ratio；這些是 provenance，不代表 ZIP 一定保存原影片。
- grid 與每個 crop rect、貼圖順序、啟用狀態、cover。
- 每張 master 的 editable range、overscan、chunk entries、chunk 起訖、source/master frame count、每格來源 timestamp/delay。
- 全域與逐張 start/end、播放秒數、loops、target frames、背景色鍵、crop/offset。
- baseline/current 的來源 timestamps、實際 selected timestamps、used indices、delays、colors、frame count、尺寸、bytes、透明/前景統計、distinct frame count、validation issues。
- 來源區間與輸出時間的 speed ratio。
- manifest schema、app/encoder version、建立與更新時間。

匯入規則：

- 先辨認 `format` 與 `schemaVersion`；LINE ZIP 缺 manifest 時顯示「這是上架包，不是可編輯專案包」。
- 未知未來版本不得猜測解析，應提示使用較新版工具。
- 舊版 migration 必須是 `unknown -> validated current model` 的純函式並有 fixture。
- entry 名稱只接受相對 POSIX path；拒絕 `..`、絕對路徑、重複 entry、異常檔數及不合理展開大小。
- 先驗 manifest，再依索引 lazy-load master/baseline/current APNG；不把整包一次解壓到記憶體。
- project import 不初始化 video decoder。只要 master chunks 可解碼，就能 rerender 已保存時間窗內的 current APNG。
- master 缺 chunk 或 chunk timeline 不連續時，仍可顯示保存的 baseline/current，但停用該張的 rerender。

## 9. 畫格規劃與降格政策

### 9.1 初始規劃

- 預設 `targetFrames = min(20, unique master frames in range)`。
- 使用者可以逐張選 5–20。
- 以 master manifest 保存的來源 presentation time 等距選取，不以 APNG chunk 內的局部 frame index 等距選取。
- always include 第一個與最後一個時間位置；若兩個請求落到同一實際 frame，去重後重新規劃。
- 若範圍內不足五個不同 frame，阻止輸出並建議延長區間。
- start/end 先 snap 到可用 master frame boundary，UI 同時顯示輸入值與實際採用值。

### 9.2 播放時間與長影片

- UI 提供合法的單輪時間 1/2/3/4 秒。
- loops 選項依單輪時間動態限制，例如 2 秒最多 2 loops，3/4 秒只能 1 loop。
- 來源區間可以是 8 秒、20 秒或更長；輸出仍可映射為 1–4 秒。
- UI 顯示「來源 8.0 秒 → 輸出 2 秒（4.00× 加速）」。
- 提供「配合來源速度」建議按鈕，但不得產生小數單輪時間；建議值只能落在合法秒數。

### 9.3 Byte auto-fit

auto-fit 每一階都回傳：

- `usedFrameIndices`
- `usedTimestampsMs`
- `delaysMs`
- `colors`
- `frames`
- `bytes`
- `overBudget`

品質順序維持可設定，但首版預設：

1. 先保 target frame，逐步減色。
2. 仍超標才減 frame。
3. 減格後用 timeline planner 重算/合併 delays，總和不變。
4. 最低五格仍超標時回 validation error，不把它包裝成正常上架成果。

## 10. 使用者介面

新增獨立 top-level tab「影片切動圖」，不要再擴大已超過 500 行的 `AnimTab.tsx`。

### 10.1 Step 1：來源

- 上傳影片或 editable project ZIP。
- 影片：顯示檔名、格式、codec、duration、display size、rotation、約略 source frame rate/時間解析度。
- Project ZIP：直接讀 manifest/master APNG，跳到調整模式，不要求原影片。
- codec 不支援時在此停止，不進入深層處理。
- 提供 cancel/restart；換來源前提示會清掉未下載的專案狀態。

### 10.2 Step 2：裁切版面

- 在可 scrub 的代表 frame 上畫出 `cols × rows` grid。
- 支援拖曳外框與內部格線、個別 rect 微調、啟用/停用、排序。
- 顯示最終要輸出的 8/16/24 個 crop。
- 可套用全域綠幕/背景色，也可逐張 override。
- crop rect 永遠使用固定 display pixels，畫面縮放只影響顯示映射。

### 10.3 Step 3：建立 master APNG

- 選擇要保留的「可編輯時間窗」與可選 overscan。
- 預估完整來源 frames、master frames、APNG chunks 與專案大小。
- 短片預設保留所有來源 frames；長片或高 FPS 超出工作預算時，要求使用者明確選擇 master sampling rate，不可靜默減格。
- 一次解碼影片並同時為各 crop 建立 master APNG chunks；完成後立即關閉 video decoder。
- 顯示 `來源 frames → master frames`、chunk 數、累積 duration 與 bytes。

### 10.4 Step 4：時間與 LINE 參數

- 雙 handle timeline + 可直接輸入 `x.x`、`y.y` 秒。
- 全域設定與 per-sticker override。
- 合法 playback/loops 選單。
- target frames 5–20。
- 顯示 master unique frames、預計保留、預計捨棄、速度倍率。
- 提供第一格 thumbnail，要求使用者確認它能表達貼圖意涵。

### 10.5 Step 5：原始/調整比較

每張貼圖卡包含：

- 左側 baseline APNG，右側 current APNG，同步重播。
- crop、source range、output duration、speed、source/used/dropped frames、colors、bytes、dimensions、validation。
- 「編輯這張」、「套用到全部」、「重設為原始」。
- 需要時開啟 onion-skin/manual offset。`ManualLayout` 應改成 controlled editor，回傳 offsets 而不是只回傳烙好的 frames。
- 改一張只 rerender 一張；改全域設定才把受影響項目標成 dirty。

### 10.6 Step 6：下載

明確分成：

- `下載 LINE 上架包`：只有驗證成功時作為 primary action。
- `下載可再次編輯的專案包`：包含 master APNG、baseline/current 與報告；不依賴原影片。
- `下載 render-report.json`：方便外部比對。
- 若 validation 失敗，只能以「下載診斷專案包」語意保存工作；不可顯示一般上架包成功按鈕。

## 11. 實作任務

### Task 0 — 解碼與效能 spike

**檔案**

- 新增 `web/src/webpipe/videoSource.spike.ts` 或獨立 spike script；定案後不把臨時碼留在 runtime。
- `web/package.json`
- `web/vite.config.ts`

**工作**

- 以一支自製 6–8 秒、4×2、H.264 MP4 驗證 metadata、rotation、sparse timestamps、VFR/實際 timestamp、worker、cancel。
- 驗證「一次影片解碼 → 八組 master APNG chunks → 關閉 decoder → 從 master rerender」的完整原型。
- 比較單一巨型 master APNG 與固定時間/frame-budget chunks 的 peak memory、bytes、encode/decode 時間。
- 測 Chrome、Safari、Firefox 的當前支援；至少把 Chrome 設為必過基線。
- 記錄 dependency 版本、license、tree-shaken bundle 增量、首格時間與 1080p/4K peak memory。
- 若選定 adapter 無法穩定取得 presentation timestamps，停止後續實作並重新評估；不可退回 `<video>` seek 後宣稱 frame-accurate。

**驗收**

- 同一影片同一 timestamp request 取得穩定的實際 timestamp。
- 不支援的 codec 在 probe 階段得到可解釋錯誤。
- 取消後 worker 停止，所有 frame/canvas 資源釋放。

### Task 1 — 修正 shared LINE 時間模型

**檔案**

- `src/core/spec.ts:29-55`
- `src/core/types.ts:78-98`
- `src/core/validate.ts:17-31`
- 新增 `src/core/animationTimeline.ts`
- 新增 `test/animationTimeline.test.ts`
- `src/config/schema.ts:68-81`
- `web/src/ui/defaults.ts`

**工作**

- 新增合法單輪播放秒數常數與型別。
- 將 `durationSec` 的模糊語意遷移成 `perLoopDurationSec`；舊 config 要明確 migration 或精確錯誤。
- 實作合法 loop 組合與 exact integer delay allocation。
- `ImageInfo` 增加成品 `delaysMs/perLoopDurationMs/distinctFrames` 等驗證所需資料。

**依賴**

- Task 0 可平行；Task 2 依賴本 task。

**驗收**

- 6/7/11/20 frames 的 delays 都精確加總為 1000/2000/3000/4000 ms。
- 1.5 秒在 schema/UI/core 都被拒絕。
- `3 sec × 2 loops` 被拒絕。

### Task 2 — 讓 Node/Web APNG 回傳真實成品時間軸

**檔案**

- `src/pipeline/apng.ts:46-196`
- `web/src/webpipe/apng.ts:52-191`
- `src/pipeline/processAnimated.ts:35-127`
- `web/src/webpipe/processAnimated.ts:29-124`
- `src/package/buildMainTab.ts:67-102`
- `web/src/webpipe/mainTab.ts:49-80`
- 相關 focused tests

**工作**

- encoder 由單一 `delayMs` 改收 `delaysMs[]`。
- 新增可回傳完整 frames + delays 的 APNG decoder；adjustment mode 不可只讀 `acTL` metadata。
- auto-fit 回傳真實 `usedFrameIndices/usedFrames/delays`。
- `autoFit: false` 不再偷偷減色或減格。
- `ProcessedAnimated` 回傳 final frame sequence，而不是減格前 fitted list。
- `main.png` 直接沿用封面貼圖成品 frames、delays、loops；main 自己若需減色，不得改 timeline。
- 編碼後重新解碼 APNG，驗證實際 delays、distinct frames、alpha/content、bytes。
- 明確區分 `encodeMasterApng` 與 `encodeLineApng`：master 可 >20 frames/>1 MB，只有 LINE 成品套官方 validator。

**依賴**

- Task 1。

**驗收**

- dump frames、貼圖 APNG 與 main APNG 使用相同的 frame selection/timeline。
- 五張完全相同的成品 frames 不通過。
- 本 task 同時關閉 implementation audit 的 P1-02、P1-03、P1-05、P1-06 中與本契約直接相關的部分；不得只在影片 UI 特判。

### Task 3 — Project manifest 與 archive validation

**檔案**

- 新增 `src/core/videoProject.ts`
- 新增 `test/videoProject.test.ts`
- 新增 `web/src/webpipe/videoProjectZip.ts`
- `web/src/webpipe/zip.ts:41-49`

**工作**

- 定義 V1 manifest、strict validator、entry index 與 migration registry。
- 實作 async/streaming project ZIP writer、Blob download helper、lazy importer。
- 保存 master APNG chunk index、每 chunk/frame 的 source timestamps/delays 與 editable range。
- 驗證 archive entry、尺寸、CRC、缺檔、重複檔、manifest/APNG 不一致。

**依賴**

- Task 1 定義的時間型別。

**驗收**

- export → import 後 manifest deep-equal（排除 updatedAt），且 master/baseline/current bytes checksum 一致。
- 壞 manifest、未來 schema、缺 master chunk、LINE-only ZIP 都有不同的精確錯誤。

### Task 4 — Browser video adapter 與 worker protocol

**檔案**

- 新增 `web/src/webpipe/videoSource.ts`
- 新增 `web/src/webpipe/videoTypes.ts`
- 新增 `web/src/workers/videoWorker.ts`
- `web/vite.config.ts`

**工作**

- 實作 `probe`, `frameAt`, `streamFrames(range)`, `abort`, `dispose`。
- 套用 rotation、pixel aspect ratio，統一成 display pixel coordinates。
- worker message 使用 request ID；只傳 transferable 資料，不傳 React state。
- 建 master 時依 presentation order 順序 decode；每個來源 frame 同時服務所有 crop，完成後立即 release。
- master chunk 達時間/frame/memory 門檻即 encode/flush，不把全片或全包 raw frames 長期存在記憶體。
- master 完成後 dispose video source；adjustment mode 不再呼叫本 adapter。

**依賴**

- Task 0 spike 結果。

**驗收**

- CFR、VFR、rotation fixture 的實際 timestamps 與 display geometry 正確。
- 24 crops 的 master 建立以 bounded batch/chunk 運行，主執行緒仍可更新進度與取消。

### Task 5 — 固定 crop、背景處理與 master APNG 建立

**檔案**

- 新增 `src/core/videoCrop.ts`
- 新增 `test/videoCrop.test.ts`
- 新增 `web/src/webpipe/videoCrop.ts`
- 新增 `web/src/webpipe/masterApng.ts`
- 視需要抽取 `web/src/webpipe/sheetAnalysis.ts` 的可重用色鍵 primitive

**工作**

- 驗證 rect 為有限整數、正尺寸、在 display bounds 內。
- 建立 grid → rects、拖曳後 snap/round、排序與 count validation。
- 同一 rect 固定套用每個 timestamp。
- 重用一致的 chroma-key/solid-color matte；統計透明 pixels、foreground pixels、opaque edge ratio。
- 不使用 `cutSheet(... align: "grid")` 或 character-anchor stabilization。
- 依 editable time window 與明確 sampling policy 將每個 crop 寫成連續 master APNG chunks。
- master 預設保留完整來源 frames；預估超出工作預算時先要求使用者選 sampling rate，記錄 `sourceFrameCount/masterFrameCount`，不可靜默降格。
- chunk manifest 保存絕對來源 timestamp；APNG 自身 delays 保存 chunk 內相對時間。

**驗收**

- 合成跳躍/走動影片的位移在輸出中保留。
- rect 不會因 frame 內容改變而漂移。
- 全空 crop 或仍為完整不透明背景的 crop 會失敗，不只是 warning。
- 連接所有 chunks 後的 frame/delay timeline 與選定 editable window 一致，chunk boundary 沒有掉格或重格。

### Task 6 — 新增 Video UI shell 與 crop editor

**檔案**

- `web/src/App.tsx:12-17`
- 新增 `web/src/ui/VideoTab.tsx`
- 新增 `web/src/ui/video/VideoSourceStep.tsx`
- 新增 `web/src/ui/video/VideoCropEditor.tsx`
- 新增 `web/src/ui/video/MasterApngBuildStep.tsx`
- `web/src/ui/common.tsx:82-150`
- `web/src/app.css`

**工作**

- 新 top-level tab，內部使用明確 step state machine。
- 新增能接受 video/project ZIP 的 file picker，不改壞 image-only workflows。
- 顯示 source metadata、scrubber representative frame、grid/crop overlay。
- 顯示 editable window、master sampling、預估/實際 chunks/bytes 與轉換進度。
- state 使用 reducer/domain model，不把 decoded raw frame 放進長期 React state。

**依賴**

- Tasks 3–5。

**驗收**

- 上傳影片後可建立、拖曳、排序並保存 8/16/24 個 rect。
- 上傳 project ZIP 後不啟動 video decoder，直接以 master APNG 進入 adjustment state。

### Task 7 — Timeline editor 與 frame plan preview

**檔案**

- 新增 `web/src/ui/video/VideoTimelineEditor.tsx`
- 新增 `web/src/ui/video/VideoStickerSettings.tsx`
- `src/core/animationTimeline.ts`

**工作**

- 雙 range + 直接秒數輸入；internally 轉 integer ms。
- 全域 defaults、per-sticker override、合法 playback/loops、target frames。
- 顯示 master/selected/dropped frames、來源 timestamp、速度倍率及第一格。
- 改參數只標記受影響 sticker dirty，需 debounce 預覽但不自動重編整包。

**依賴**

- Tasks 1、3、5、6。

**驗收**

- `x.x/y.y` 輸入、拖曳與 manifest round-trip 不發生浮點漂移。
- start >= end、超出 duration、unique frame <5 都在 render 前被擋下。

### Task 8 — Master APNG → LINE APNG render pipeline

**檔案**

- 新增 `web/src/webpipe/processMasterApngSticker.ts`
- `web/src/webpipe/processAnimated.ts`
- `web/src/webpipe/fitCanvas.ts`
- 新增 `web/src/workers/apngEditWorker.ts`
- 新增 browser-focused integration tests

**工作**

- 對一張 sticker：找出相交 master chunks → decode frames/delays → timeline plan → optional offsets → shared canvas plan → LINE APNG。
- 使用 sequence union content bounds 選最小合法偶數 canvas，不一律寫死 320×270。
- 每階段回 progress、metrics、notes 與可取消狀態。
- 成功後原子更新 current；第一次成功時建立 baseline。
- baseline/current 只保存 APNG bytes 與資料；raw frames 完成後立即釋放。

**依賴**

- Tasks 2、3、5、7。

**驗收**

- 一支超過四秒的 4×2 影片能產出八張不同 APNG。
- 每張 5–20 格、合法時間/loops、透明、<=1 MB，且 movement 未被自動穩定化消除。
- 完成 master 後移除原始 video `File` reference，仍能只靠 master rerender 不同 x.x–y.y 與 frame count。

### Task 9 — Adjustment mode 與 baseline/current 比較

**檔案**

- 新增 `web/src/ui/video/VideoStickerEditor.tsx`
- 新增 `web/src/ui/video/VideoCompareGrid.tsx`
- refactor `web/src/ui/ManualLayout.tsx:20-113`

**工作**

- side-by-side baseline/current APNG、同步 replay、metrics delta。
- ManualLayout 改成受控 `offsets`，offsets 可序列化；實際烙 frame 由 pipeline 做。
- 支援單張 reset、套用全包、rerender one/rerender dirty。
- saved output 與 dirty/failed output 狀態分開；失敗不得清掉上一版 current。

**依賴**

- Task 8。

**驗收**

- 調整一張不重編其他張。
- reset 後 settings 與 baseline snapshot 一致。
- 匯入已調整專案時直接顯示保存的 current，而不是 baseline。

### Task 10 — Project/LINE 下載與完整驗證

**檔案**

- `web/src/ui/packResult.tsx:21-47`
- 新增 `web/src/ui/video/VideoDownloads.tsx`
- `web/src/webpipe/videoProjectZip.ts`
- `web/src/webpipe/zip.ts`
- `src/core/validate.ts`

**工作**

- 用 current renders 建 main/tab/LINE ZIP。
- validation success 才啟用一般 LINE ZIP 按鈕。
- 建 project ZIP 時寫入 master APNG chunks、baseline/current、manifest、reports；source video 預設不寫入。
- 報告列出每張成品的 final decoded metadata，而不是只相信設定。

**依賴**

- Tasks 2、3、8、9。

**驗收**

- LINE ZIP entries 精確且不含 manifest、master 或 source video。
- Project ZIP 可單檔恢復保存時間窗與 overscan 內的完整調整狀態，匯入與 rerender 都不初始化 video decoder。
- validation error 只提供診斷專案保存，不以「上架包完成」呈現。

### Task 11 — 測試、文件與 rollout

**檔案**

- `test/*.test.ts`
- `web/scripts/smoke.mjs`
- 新增小型、可重現、專案自製的 video fixtures
- `README.md`
- `ARCHITECTURE.md`
- `web/README.md`
- `plan/implementation-audit.md`

**工作**

- 補 core unit、archive round-trip、browser integration、Playwright E2E、memory/cancel probes。
- README 說明支援格式、瀏覽器需求、兩種 ZIP 與本機處理。
- ARCHITECTURE 增加 video adapter、project manifest 與 baseline/current data flow。
- implementation audit 只關閉有 failing regression test 與實際 flow 證據的項目。
- 先以 feature flag 或明確 beta 標籤推出；unsupported codec/error 只寫入本機可下載的診斷報告，不新增遙測。

**依賴**

- 所有前置 tasks。

## 12. 測試策略

### 12.1 Shared core unit tests

- 合法/非法 playback × loops 矩陣。
- 5、6、7、11、20、>20 source frames。
- VFR timestamps、重複 timestamp、非零首 timestamp。
- 來源區間很長、很短、越界、start=end。
- frame reduction 後 delays 精確保留總長。
- master chunk index 的連續、重疊、缺口與 boundary frame 去重。
- manifest 的絕對 source timestamp 與 APNG 相對 delay 對應。
- crop rect bounds、grid count、排序。
- manifest strict parsing、migration、unknown version。

### 12.2 APNG regression tests

- 讀回 frame count、loops、每格 delays 與總長。
- master APNG 可超過 20 格/1 MB 且能被內部 decoder 接受，但同一檔案不得被誤判成 LINE 合規成品。
- 多個 master chunks 串接後的 frames/delays 與建立時 timeline 一致。
- auto-fit result 的 used indices 與真正 APNG frames 一致。
- main 與 cover 的 timestamps/delays/loops 一致。
- identical frames 被拒絕；部分重複但仍有 motion 可通過。
- 透明、空白、opaque-edge、1 MB 邊界。

### 12.3 Browser integration fixtures

至少準備：

- 6–8 秒、4×2、每格不同運動的 H.264 MP4，來源長於 LINE 上限。
- VFR fixture。
- rotation metadata fixture。
- 綠幕與已透明影片。
- 低 FPS，選定區間不足五個 unique frames。
- unsupported codec/container fixture 或 mock capability。
- 一組跨兩個 master chunks 的時間區間，以及缺失中間 chunk 的 project ZIP。
- 一個損壞 project ZIP 與一個舊 schema ZIP。

### 12.4 E2E 使用者流程

1. 上傳 4×2 影片。
2. 建立八個 crop。
3. 選 editable window，建立八組 master APNG chunks，確認 video decoder 已 dispose。
4. 全域選 `1.2s–5.8s`，逐張改其中一張。
5. 產 baseline，調整 time/frame count/offset，產 current。
6. 確認 baseline/current 與 metrics delta。
7. 下載 project ZIP，確認 ZIP 不含 source video。
8. 開新 page，上傳 project ZIP。
9. 確認未啟動 video decoder，rect、時間、offset、master、baseline/current bytes 與報告皆恢復。
10. 改選一個跨 master chunk boundary、但仍在 editable window 內的區間並 rerender。
11. 下載 LINE ZIP，解開檢查 entries 與所有 APNG metadata。

### 12.5 標準驗證命令

```bash
npm run typecheck
npm test
npm run build
cd web
npm run build
```

Browser E2E 仍需依 `AGENTS.md` 啟動 preview server，再執行 smoke。若 checkout 缺 fixture 或 Playwright browser，必須明確報告，不能宣稱 E2E 通過。

## 13. 效能與失敗處理

- 不把原始影片整份轉成 RGBA frames。
- 建立 master 時依 presentation order 順序解碼；一個來源 frame 同時供所有 crop 使用，再立即 release。
- master APNG 達時間、格數或記憶體門檻即 flush 為 chunk，不在記憶體保留整段 raw RGBA。
- adjustment mode 只 lazy-decode 與選定區間相交的 master chunks；完成 render 後釋放 decoded frames。
- APNG encode、色鍵與 pixel metrics 放 worker，主執行緒只收進度與成品。
- 預估工作記憶體超標時降低 batch size，不降低輸出品質而不告知使用者。
- master 全格保存超出預算時，先顯示預估並要求使用者選擇 editable window 或 sampling rate；報告必須同時列 `sourceFrameCount/masterFrameCount`。
- 每個長步驟都有 AbortSignal；換檔、切 tab、重新匯入時先 dispose 舊 worker、video source 與 decoded APNG frames。
- Project ZIP 串流建立；UI 顯示 master chunks 的實際總 bytes 與預估 ZIP bytes。LINE ZIP 不含 master 或來源影片。
- 匯入 project ZIP 不依賴 source codec；master 完整時可查看、調整及下載，master 損壞時至少保留 baseline/current 的查看與下載能力。

## 14. 風險與反證

### 風險 A：WebCodecs 不代表所有影片都可解碼

容器解析成功不等於 codec 可解。mitigation 是 probe 階段同時做 track `canDecode`/`VideoDecoder.isConfigSupported`，首版列出實測支援格式，不用檔案副檔名猜測。

### 風險 B：master APNG 可能比來源影片更大

APNG 是 lossless frame storage；長時間、高 FPS 或高雜訊影片轉成多個 crop 後，總 master bytes 可能遠高於 MP4。mitigation 是先做大小預估、限制 editable window、依時間/frame/memory budget 分 chunk，且超出預算時要求使用者明確選 sampling rate。不可把 master 默默降格，也不可宣稱 project ZIP 一定比原影片小。

### 風險 C：固定 crop 可能裁到跨格物件

固定 crop 是避免時間抖動的必要選擇。UI 必須讓使用者調 rect、預覽起訖/中間 frame，並回報 opaque edge ratio；首版不宣稱能自動追蹤跨格物件。

### 風險 D：等時間抽格可能漏掉很短的關鍵動作

首版先提供 deterministic time-uniform selection 與手動 target/range。後續可在不改 manifest 主契約的情況下加入 motion-aware selector；不得在首版用未驗證 heuristic 取代可解釋的選取。

### 風險 E：現有動畫 correctness 缺口讓影片功能看似完成、實際不可上傳

Tasks 1–2 是 hard prerequisite，不得把修正埋成 VideoTab 私有邏輯。若 exact delays、final frame contract、main timeline 與 final decode validation 未完成，VideoTab 只能保留實驗狀態，不能提供一般 LINE 上架包。

### 風險 F：APNG 本身不足以恢復來源時間與編輯語意

APNG 保存 frame order 與相對 delay，但不保存影片的絕對 presentation timestamp、原 crop、editable window、sampling decision 或 baseline/current 關係。因此可重新編輯的單位必須是 project ZIP，而不是一組裸 APNG；匯入時要交叉驗證 manifest 與 chunk 的實際 frame/delay 資料。

### 風險 G：移除原影片會限制重新裁切範圍

只保存 master APNG 後，使用者可在已保存時間窗內重新選時間、降格、改 delay/offset/canvas，但不能找回時間窗外的 frames，也不能把 crop 移到 overscan 外。UI 與下載說明必須明示這個邊界；需要任意重畫 grid 時，重新指定原影片或使用後續可選的 full-source project。

## 15. 里程碑與建議順序

### Milestone 0 — 動畫 correctness 基線

完成 Tasks 0–2。此階段尚無完整影片 UI，但時間與 APNG 成品契約已可信。

### Milestone 1 — 影片建立 master 與 baseline

完成 Tasks 4–8 的最小路徑：上傳影片、固定 4×2 crop、建立八組 master APNG chunks、關閉 video decoder，再由 master 產生八張 baseline APNG。

### Milestone 2 — 可調整與 round trip

完成 Tasks 3、6、7、9、10：per-sticker 調整、baseline/current、project ZIP export/import、LINE ZIP。

### Milestone 3 — Hardening

完成 Task 11、24 張 batch、VFR/rotation/unsupported codec、取消、損壞 ZIP、文件與 beta rollout。

## 16. Definition of Done

只有以下條件全部成立，才算此功能完成：

- 一支超過四秒、每 frame 為 4×2 大圖的影片，可在 Web 中裁成八張 APNG。
- 每張可獨立設定 x.x–y.y 秒，UI 顯示 source span、output duration 與 speed ratio。
- 每張成品實際解碼後為 5–20 格、合法 1/2/3/4 秒、合法 loops、透明、非全相同、<=1 MB。
- frame reduction 的 selected timestamps、indices、delays 與成品一致，且資料可見、可下載。
- 動畫中的真實空間位移沒有被自動 alignment 消除。
- baseline 不因後續調整被覆寫，current 可逐張 reset/rerender。
- master 建立完成後，即使釋放原始 video `File` 與 decoder，仍能在已保存 editable window 內 rerender。
- Project ZIP 不含原始影片；單檔重新匯入後會直接顯示保存的調整結果，並可在 master 時間窗與 overscan 範圍內再次修改。
- Project ZIP 中的 manifest 可解釋 master sampling、絕對 timestamps、chunk boundaries、baseline/current 與所有成品數據。
- LINE ZIP 與 Project ZIP 清楚分離；validation error 不顯示一般上架成功語意。
- Node/Web shared animation tests、root build、Web build 與實際 browser E2E 均通過，或任何環境限制被明確列出。

## 17. 實作前仍可調整、但不阻擋本計畫的產品選項

本計畫先採以下 defaults：

- Chrome 為 MVP 必過瀏覽器；Safari/Firefox 依 Task 0 實測標示支援程度。
- project ZIP 預設只嵌入 master APNG chunks，不嵌入原始影片；round trip 的可編輯範圍以 manifest 記錄的 editable window/overscan 為界。
- 短片在預算內保留所有來源 frames；超出預算時由使用者明確選 editable window 或 master sampling rate。
- baseline 預設 target 20 frames，byte 超標才減格。
- video crop 不開自動 character stabilization。
- motion-aware frame selection 延後，首版使用可解釋的 time-uniform selection。

若要縮小第一版，優先延後「逐 frame manual offsets」、full-source project 與 24 張效能優化；不可延後 master chunk round trip、exact timing、final frame contract 或 validation gate。
