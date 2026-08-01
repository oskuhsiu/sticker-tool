# 功能實作合理性審查

審查日期：2026-07-29

## 審查目的

這份審查逐項確認目前功能的實作是否合理、是否符合使用者流程與 LINE 規範。能否 typecheck、build，不算功能正確的證據。

審查範圍：

- `src/core/` 的 LINE 規格、驗證、網格、切格與 prompt
- 設定檔解析與正規化
- CLI `build`、`gen`、`anim`、`prompt`、`init`
- Node 靜態圖、組圖、動畫、main/tab、ZIP pipeline
- Web 的 build、組圖、動畫、prompt、手動排版與下載流程
- Web 啟動頁、COOP/COEP service worker 與部署設定
- 現有測試、smoke/eval scripts 所表達的預期行為
- `AGENTS.md` 列出的四個可選工作流：`char-gen`、`gif-frames`、`anim-set`、`line-sticker-pack`

未納入：

- `dist/`、`web/dist/`、`out/`、`eval/`、`spike/`、`tmp/` 等 generated output
- `node_modules/`、Git 歷史、secret files 與不屬於貼圖產品流程的本機 skill
- 實際第三方產圖服務的品質、LINE 審核的藝術/商標/著作權判斷、所有瀏覽器與所有真實圖片排列組合

覆蓋說明：

- 第一輪只完整涵蓋 deterministic CLI/core/browser，因此不能稱為全產品完整審查。
- 第二輪已補讀部署入口與上述四個生成/編排工作流，並以官方規範、source trace 與針對性 runtime probe 交叉核對。
- 「已找出 90% 的問題」沒有可驗證的母數，不能誠實保證。本文件能保證的是列出的 scope 與檔案已逐項走讀；不能保證所有未知輸入、外部服務或未表達需求中的問題已被發現。

官方基準：

- [LINE 靜態貼圖製作準則](https://creator.line.me/en/guideline/sticker/)
- [LINE 動態貼圖製作準則](https://creator.line.me/zh-hant/guideline/animationsticker/)
- [LINE 動態貼圖畫格與播放時間細則](https://creator.line.me/en/guideline/animationsticker/detail/)

優先級：

- **P1**：可能造成上傳失敗、錯誤宣稱「符合規格」，或直接改壞貼圖內容。
- **P2**：公開功能/選項與實際行為不符，或失敗處理會誤導使用者。
- **P3**：驗證或品質缺口；應在主要正確性問題後處理。

## 總結

整體分層方向合理：shared core 保持平台中立、Node/Web 各自處理影像 I/O、確定性打包、元件式切格、APNG 編碼後回讀 metadata，這些選擇都沒有根本問題。

但目前還不能可靠地把輸出稱為「可直接上架」，而且可選動畫工作流無法照文件完成整包：

1. 驗證可能把空白、仍有背景、或完全不會動的貼圖判為合格。
2. 動態貼圖接受 LINE 明確不允許的小數播放秒數；內建動作庫 12 個動作中有 11 個使用這種秒數。
3. frame-sheet 的自動對齊會消除跳躍等真正的動作。
4. APNG 壓縮後實際採用的畫格/速度沒有傳給 main 與 dump 功能。
5. `anim-set` 的 APNG 輸出不能交給只接受逐格 PNG 的 `anim --config`；`line-sticker-pack` 也沒有把 frames-sheet 轉成該格式。
6. 多個設定欄位能通過 schema，實際上卻沒有作用。

第二輪合計列出 **22 個已確認問題（P1 8、P2 10、P3 4）與 1 個待產品決策風險**。

### 2026-08-01 Video → APNG V2 實作補充

Web 的影片 adapter 已改成獨立的 V2 路徑，這不代表下列 CLI／既有 Anim 問題已全域關閉：

- Mediabunny + WebCodecs 以 decoded presentation samples 建立整數微秒索引；V2 ingest 不再使用
  `<video>` seek 或固定 10/20/30/40/60 格取樣。
- raw master 在去背前保存完整 sample refs；相同像素只去重 visual payload，不刪 timestamp/duration。
- 每張 current 以 hard target 格數重編，只降色、不 silent 減格；相鄰相同成品格合併 delay 後補選，
  並從最終 APNG bytes 重開檢查格數、delay、loops、alpha、內容與 bytes。
- 動態 cover main 沿用封面 current 的 actual frames/delays/loops；tab 取 actual first frame。
- 一般 LINE ZIP 只在 current 完整、無 dirty 且 final-byte validation 通過時提供；有完整 bytes 但不合規時，
  只能明確確認下載 `NOT-LINE-COMPLIANT`；缺必要 bytes 仍硬阻擋。
- Project ZIP V2 保存 raw/timing/selection/checksum/version，採 bounded streaming import；V1 只映射成
  `sampled-legacy`/`baked-legacy`，不補造缺失 frame 或 raw RGB。

針對證據包括 `test/videoTimeline.test.ts`、`test/frameSequence.test.ts`、
`web/scripts/video-project-roundtrip.mts`、`web/scripts/video-all-frames-spike.mts` 與
`web/scripts/video-smoke.mjs`。P1-02、P1-03、P1-05、P1-06、P2-07 等 checkbox 仍涵蓋其他 adapter；
除非各自的 CLI／Web Anim 驗收也完成，不因 Video V2 局部修正而關閉。

## 功能逐項覆蓋表

「主要結果」只列最直接的 issue；同一底層問題可能影響多列。

| 功能/流程 | 審查內容 | 主要結果 |
|---|---|---|
| Shared LINE spec / validation | 張數、尺寸、bytes、alpha、APNG、main/tab、ZIP | P1-01、P1-02、P1-03、P2-07、P3-01 |
| Config load / normalize | schema、default、kind 推導、路徑、跨欄位狀態 | P1-02、P2-01、P2-04 |
| CLI `build` | 本機圖片列舉、去背、fit、疊字、main/tab、ZIP | P1-01、P2-04、P2-06、P2-07 |
| CLI `gen` | 組圖版面、背景分析、切格、逐格處理、pack | P1-01、P2-01、P2-04、P2-06 |
| CLI `anim --sheet` | grid 解析、切格對齊、APNG、dump、validation | P1-02、P1-04、P1-05、P2-05、P2-08 |
| CLI `anim --config` | frame list、fps/duration、逐張處理、main/tab、pack | P1-02、P1-05、P1-06、P1-07、P1-08、P2-01 |
| CLI `prompt` | 靜/動種類、layout、grid、跨 sheet variations | P2-02、P2-03、P2-04 |
| CLI `init` / example config | 範例欄位與可執行性 | P1-02、P2-01、P3-04 |
| Node image pipelines | remove-bg、fit、stroke、text、PNG/APNG 壓縮 | P1-01、P1-05、P1-07、P2-08、P3-02 |
| Web 靜態 build | input、處理、main/tab、ZIP、錯誤結果 UI | P1-01、P2-06、P2-07 |
| Web 靜態 sheet | grid、切格、去背、逐張文字、ZIP | P1-01、P2-01、P2-06、P3-02 |
| Web 動畫 sheet / manual | grid、對齊、preview、手動調整、APNG | P1-02、P1-04、P1-05、P2-05、P2-08 |
| Web 動態 pack | 多貼圖 input、處理、main/tab、ZIP | P1-02、P1-05、P1-06、P1-07、P2-06、P2-07 |
| Web prompt | 靜態/動畫 prompt、custom variations | P2-03、P3-03 |
| ZIP / main / tab packaging | entry、命名、cover、發布順序 | P1-06、P2-06、P2-07 |
| `char-gen` | frames-sheet 契約、透明退路、normalize | P2-09 |
| `gif-frames` | 輸入格式、取樣、timeline、交接 duration | P1-02、P2-10 |
| `anim-set` | 動作庫約束、sheet→APNG、整包交接 | P1-02、P1-08、P3-03 |
| `line-sticker-pack` | 靜/動生成到 CLI pack 的完整交接 | P1-08、P3-04 |
| Web bootstrap / deployment | Vite base、service worker、靜態部署、same-origin 資源 | 未發現重大功能邏輯問題 |

## 已確認問題

### [ ] P1-01 — 驗證會把空白圖或視覺上仍有背景的圖判為合格

影響：shared validation、CLI/Web 靜態包、CLI/Web 動態包、組圖切格。

觀察：

- `ImageInfo` 只有 `hasAlpha`，沒有前景像素數、透明像素數或殘留背景資訊：`src/core/validate.ts:20-33`。
- 靜態驗證把「有 alpha channel」當成「背景已透明」：`src/core/validate.ts:65-92`。
- 動態驗證完全不檢查 alpha：`src/core/validate.ts:95-145`。
- Web 動畫 pipeline 直接寫死 `hasAlpha: true`、`channels: 4`：`web/src/webpipe/processAnimated.ts:112-123`。
- 組圖抽到空格時只警告，後續仍會處理、打包：`src/cli/cutReport.ts:33-35`、`src/cli/commands/gen.ts:98-145`、`web/src/ui/SheetTab.tsx:80-121`。
- 記憶體探針把全透明 64×64 圖處理成 320×320、228 bytes 的 PNG，`validateStaticImage` 回傳 `ok: true`。
- 只要 metadata 宣稱 `hasAlpha: true`，即使 RGBA 全部不透明，靜態驗證仍回傳 `ok: true`。

不合理之處：

- alpha channel 是儲存格式，不代表實際背景已去除。
- 靜態 pipeline 會自己加透明 margin；因此一張仍有完整矩形背景的照片，也可能因新增 margin 而取得 alpha channel。
- 空格會變成格式正確的 PNG，最後卻顯示「全部符合 LINE 規格」。

修正方向：

- 增加 `foregroundPixels`、`transparentPixels`、`opaqueEdgeRatio` 或殘留背景訊號。
- 必填格為空/近空時應是 error，不是 warning。
- 靜態與動態都要從最終解碼像素驗證透明度。
- `--no-remove-bg` /「不去背」應先確認原圖已透明，再進入會自加 margin 的流程。

驗收：

- 全透明貼圖驗證失敗。
- 未去背 JPEG 不會被報告為合格。
- 必填格有任一空格時，不產生一般的上架包。
- 動態透明度來自最終 APNG 解碼結果，不是寫死旗標。

### [ ] P1-02 — 接受 LINE 不允許的 0.5、1.5、2.5 秒等小數播放時間

影響：設定檔、CLI `anim`、Web 兩種動畫模式、shared validation。

觀察：

- schema 允許任意正數 `durationSec`：`src/config/schema.ts:68-80`。
- Web UI 明確提供 `step=0.1`，最小可填 0.2 秒：`web/src/ui/AnimTab.tsx:182-186`、`web/src/ui/AnimTab.tsx:436-440`。
- pipeline 只確保 `loops × duration <= 4`，沒有把單輪時間限制為 1、2、3、4 秒：`src/pipeline/processAnimated.ts:90-97`、`web/src/webpipe/processAnimated.ts:87-94`。
- `ImageInfo` 沒有 duration/delay，最終驗證無法發現。
- 探針產出五格、每格 300ms、總長 1.5 秒的 APNG，驗證仍為 `ok: true`。
- encoder 把同一個浮點 delay 分別 `Math.round` 給每格：`src/pipeline/apng.ts:46-56`、`web/src/webpipe/apng.ts:45-55`。即使要求合法的 1 秒，6/7/11 格實際總長也會變成 1002/1001/1001ms。
- `anim-set` 只檢查 `loops × durationSec <= 4`：`.claude/skills/anim-set/SKILL.md:43-45`；動作庫 12 個動作中，只有一個使用整數秒，其餘 11 個使用 1.3、1.6、1.7、1.8 秒：`.claude/skills/anim-set/data/action-library.yaml:59-412`。
- `gif-frames` 建議把任意補償後的毫秒數交給 `anim --duration`：`.claude/skills/gif-frames/SKILL.md:49-52`，也沒有轉成 LINE 允許的 1/2/3/4 秒。
- LINE 官方細則明確說播放時間只能選 1、2、3、4 秒，1.5 秒不允許。

另外，`AnimationConfig.durationSec` 在 `src/core/types.ts:80-84` 與範例設定中被描述成「總播放長度」，pipeline 卻把它當「單輪長度」再乘 loops，語意不一致。

修正方向：

- 改成語意明確的 `perLoopDurationSec: 1 | 2 | 3 | 4`。
- 分配整數毫秒餘數，讓所有 frame delays 加總精確等於 1000/2000/3000/4000ms，而不是每格各自四捨五入。
- 從編碼後 APNG 的 frame delays 驗證單輪時間與 `loops × 單輪時間 <= 4`。
- CLI/Web 輸入階段直接拒絕，不要先產檔再顯示錯誤。
- 同步修正 `anim-set` 動作庫與 `gif-frames` 的交接說明。

驗收：

- 所有非整數秒數都被拒絕。
- 合法秒數在不同 frame count 下，解碼後 delays 加總仍精確合法。
- 型別、設定範例、CLI、Web、貼圖 APNG、main APNG 對 duration 的定義一致。
- 最終驗證使用 APNG 實際 delays，而不是只相信設定值。

### [ ] P1-03 — 所有畫格完全相同的 APNG 仍被判定合格

影響：CLI/Web 單張動畫與動態整包。

觀察：

- 動態驗證只檢查 APNG、格數、loops、尺寸、bytes，不檢查畫格是否真的有變化：`src/core/validate.ts:95-145`。
- 探針把五張完全相同的圖編成 APNG，結果是 `isApng: true`、`frames: 5`、`loops: 1`，驗證為 `ok: true`。
- LINE 官方明確指出：所有畫格使用相同圖檔時，上傳會發生錯誤。

修正方向：

- 解碼最終 APNG，比較 frame pixel/hash。
- 至少需要兩個不同的視覺狀態。
- 必須在量化、減格完成後檢查，因為原本略有差異的畫格可能在壓縮後變成相同。

驗收：

- 五張完全相同的輸入不能取得上架包。
- 部分重複、但至少有兩個不同狀態的正常循環仍可通過。

### [ ] P1-04 — Frame-sheet 的自動對齊會消除真正的動作

影響：CLI `anim --sheet`、Web「單張組圖 → 一段動畫」、手動排版的初始結果。

觀察：

- `align: "grid"` 先做 scene alignment，之後又無條件套用下半身 X/Y 錨定：`src/core/cells.ts:470-535`。
- 原始碼註解自己已說腳底基線對齊不適用跳躍動作：`src/core/cells.ts:302-310`。
- CLI/Web 的 frame-sheet 一律使用這個模式：`src/cli/commands/anim.ts:86-95`、`web/src/ui/AnimTab.tsx:112-140`。
- 合成探針輸入的垂直位置是 `[10,25,40,25,10]`，抽格後變成 `[0,0,0,0,0]`，跳躍完全消失。

不合理之處：

- 要消除的是生成/構圖漂移，不是角色刻意位移。
- prompt 支援任意循環動作，不只「站在地上、腳不動」的角色。
- UI 說保留 grid 座標，但實作會再次平移。

修正方向：

- 明確拆成不同策略：
  - `preserve-grid`：保留每格在原始 cell 內的相對位置。
  - `scene`：有固定場景時才做場景對齊。
  - `character-anchor`：站姿動作才選用身體錨點。
  - `manual`：不做自動修正。
- 不可無條件套用下半身錨定。
- 增加 jumping、walking、camera-pan、stationary-scene fixtures。

驗收：

- 跳躍保留垂直位移。
- 固定背景不漂移。
- CLI/Web 清楚顯示目前策略與代價。

### [ ] P1-05 — `animation.autoFit: false` 沒作用，且沒有回傳最終真正採用的畫格

影響：Node/Web 動畫 pipeline、main 產生、CLI dump frames。

觀察：

- `autoFit` 存在於型別與 schema，但兩個動畫 pipeline 都沒有讀取。
- Node/Web 都無條件呼叫 `encodeApngAutoFit`：`src/pipeline/processAnimated.ts:99-109`、`web/src/webpipe/processAnimated.ts:96-107`。
- `ProcessedAnimated.fittedFrames` 回傳減格前的全部 frame，不是最終 APNG 使用的 frame：`src/pipeline/processAnimated.ts:114-127`、`web/src/webpipe/processAnimated.ts:112-124`。
- 探針輸入十格，設定 `autoFit: false` 且 ladder 指定五格，最後仍編成五格，`fittedFrames.length` 卻是十。
- CLI `--dump-frames` 宣稱 dump 的 frame 與 APNG 一致，實際使用減格前清單：`src/cli/commands/anim.ts:126-136`。

修正方向：

- `autoFit: false` 時只執行一次指定品質的 encode；超標就回 validation error，不可自行降級。
- encoder 回傳 `usedFrameIndices`、實際 frames、colors、delay、單輪時間。
- dump 與衍生圖都使用實際結果。

驗收：

- `autoFit: false` 不會減色/減格。
- dump frames 與最終 APNG 一對一。
- result object 能指出最終使用哪些來源 frame。

### [ ] P1-06 — 動態 `main.png` 可能與封面貼圖的格數、速度不同

影響：CLI/Web 動態整包。

觀察：

- main 使用 `cover.fittedFrames`，也就是減格前清單：`src/cli/commands/anim.ts:183-187`、`web/src/ui/AnimTab.tsx:383-387`。
- main 自己從 `animation.durationSec` 重算時間，忽略 `StickerItem.fps` 與貼圖 pipeline 實際 clamp 後的 duration：`src/package/buildMainTab.ts:67-89`、`web/src/webpipe/mainTab.ts:49-68`。
- 探針以五格、`fps: 10` 產出 500ms 的貼圖 APNG，但 main APNG 是 2000ms。
- 若封面貼圖由十格減成五格，main 仍從十格開始，可能得到另一組 frame selection。

修正方向：

- main 必須從封面貼圖實際採用的 frame sequence 與 delays 產生。
- 不要再從全域 config 重新推導時間。
- main 若需另外壓 bytes，應只改解析度/色數，保留封面 timeline。

驗收：

- 貼圖與 main 的 loops、單輪時間、視覺 frame sequence 一致。
- fps、duration、clamp、減格四種情況都同步。

### [ ] P1-07 — 來源 frame 尺寸不同時會縮放跳動或變形

影響：CLI/Web 以獨立 frame 檔製作動畫。

觀察：

- 關閉 stabilization 時，Node 直接把不同尺寸 frame 各自 exact-fit：`src/pipeline/processAnimated.ts:72-87`。
- Web 先把所有 frame 強制拉成第一格寬高：`web/src/webpipe/processAnimated.ts:56-65`。
- 兩端行為不一致；Web 在比例不同時還會非等比拉伸。
- Node 探針在 100×100、200×100 畫布中放相同 20px 主體，輸出主體寬度交替變成 55px、33px。

修正方向：

- 選擇其中一個明確政策：
  - 尺寸/比例不同立即報錯；或
  - 以 shared union canvas 補透明邊，不能非等比拉伸。
- Node/Web 使用同一規則。
- 尺寸正規化不應依賴 stabilization 是否開啟。

驗收：

- 相同主體跨 frame 保持相同顯示比例。
- 不同 aspect ratio 不會被靜默拉伸。
- Node/Web 對同一輸入的結果與錯誤一致。

### [ ] P1-08 — 文件宣稱的動畫生成工作流無法交給整包打包

影響：`anim-set`、`line-sticker-pack`、CLI `anim --config`。

觀察：

- `anim-set` 每個動作的交付物是已編碼的 `<id>.png` APNG：`.claude/skills/anim-set/SKILL.md:58-76`、`:109-115`。
- 同一文件叫使用者把這些 APNG 交給 `line-sticker-pack` 的 `anim --config`：`.claude/skills/anim-set/SKILL.md:124-129`。
- 但 `anim --config` 不接受成品 APNG；它要求每張貼圖的 `stickers[i].frames` 是 5–20 個「獨立 frame 圖檔」路徑，再重新編碼：`src/cli/commands/anim.ts:143-175`。
- `line-sticker-pack` 叫 `char-gen` 為每張動畫產一張 frames-sheet，之後卻直接要求在 `stickers[i].frames` 填「char-gen 產出的影格路徑」：`.claude/skills/line-sticker-pack/SKILL.md:45-50`、`:56-89`。流程中沒有把每張 sheet 切成 frame files、也沒有把切出的路徑寫回 config。
- `anim --sheet --dump-frames` 理論上可作為橋接，但兩個工作流都沒有執行、收集與組 config 的步驟；而且目前 dump 又受 P1-05 影響，不一定等於 APNG 最終畫格。

不合理之處：

- 使用者照文件做完每段仍無法得到 8/16/24 張的動態上架包。
- 同一個 `.png` 在文件裡同時被當成 frames-sheet、獨立 frame、成品 APNG，資料契約沒有區分。

修正方向：

- 明確選一種整包輸入契約：
  - `anim --config` 支援既有 APNG，驗證後直接打包；或
  - 提供 `anim prepare-sheet`，切格後輸出 manifest，再由 pack 消費；或
  - `line-sticker-pack` 直接逐張呼叫 shared sheet processor，不用中間 APNG/檔案猜格式。
- 為 `frame image`、`frames-sheet`、`animated sticker APNG` 使用不同欄位名稱與型別。
- 加一個從 master/frames-sheet 到 8 張動畫 ZIP 的端到端 fixture。

驗收：

- 按 `anim-set` → `line-sticker-pack` 文件逐步操作，可以不手改中間資料就產出完整 ZIP。
- CLI 在拿到錯誤種類的 `.png` 時立即指出「收到 APNG/frames-sheet，但此欄位需要單格 PNG」，不能在深層才失敗。

### [ ] P2-01 — 多個公開設定欄位會被解析，但不影響實際行為

影響：CLI config、`gen`、`anim`、`prompt`。

| 欄位 | 宣稱用途 | 實際行為 |
|---|---|---|
| `animation.autoFit` | 控制是否自動降級 | 完全忽略，永遠 auto-fit。 |
| `ai.crop` | `equal` / `equal+rembg` | 有 load，但 `gen` 直接呼叫 `cutSheet`；`cropGrid` 沒有任何 caller。 |
| `stickers[].input` | 靜態逐張本機輸入 | 有解析，但沒有 command 消費；`build` 不讀 config，`gen` 忽略 input。 |
| `stickers[].motion` | 動態生成動作 | CLI prompt/runtime 都不使用。 |
| 動態包的 `processing.maxSize` | 設定輸出 bounds | `runPack` 寫死 `maxBounds("animated")`：`src/cli/commands/anim.ts:155-173`。 |
| CLI 單組圖的 `processing.removeBackground: "auto"` | 自動判斷殘留背景 | 被轉成 `false`；只有 literal `true` 會傳到下游：`src/cli/commands/anim.ts:91-101`。 |
| `gen` 的 `processing.removeBackground: false` | 不去背 | `cutSheet` 仍先偵測並去背；`true` 反而可能在切格後再去背一次。 |
| 多張 sheet 的 `ai.grid` | 自訂每張版面 | `applyGridOverride` 遇到 `layout.sheets !== 1` 就靜默忽略：`src/cli/commands/gen.ts:32-40`；Web 同樣只在單 sheet 套用。 |
| `ai.forceOversizeSet` | 角色包 >16 張的明確 opt-in | `prompt` 會據此阻擋/放行，但 CLI/Web `gen` 把 blocked 降成 warning 並照樣處理：`src/cli/commands/gen.ts:70-82`、`web/src/ui/SheetTab.tsx:52-58`。 |

修正方向：

- 每個欄位要嘛接上明確 workflow，要嘛從 schema、範例、型別移除。
- 加入 config-consumption test，證明每個公開欄位確實改變行為，或明確標成 prompt-only。

驗收：

- 不再有靜默無效的公開設定。
- 不支援的欄位組合在 load config 時給精確錯誤。

### [ ] P2-02 — CLI `prompt` 可能產出與後續 `gen` 不一致的模式/網格

影響：CLI `prompt`。

觀察：

- `gen` 在單張組圖時會套用 `cfg.ai.grid`：`src/cli/commands/gen.ts:32-41`。
- `prompt` 忽略 `cfg.ai.grid`，只使用 auto layout：`src/cli/commands/prompt.ts:21-44`。
- `prompt` 忽略 `cfg.kind`，永遠呼叫 `buildSheetPrompt`，從不呼叫 `buildFramesPrompt`。
- 因此 custom-grid config 的 prompt 與切格網格可能不同；animated config 也只會得到靜態組圖 prompt。

修正方向：

- `prompt` 與 `gen` 共用同一個 layout resolver。
- animated config 應要求 motion/frame 設定並使用 `buildFramesPrompt`；若 CLI 不支援，應明確拒絕。
- prompt output 附上 resolved mode/grid。

驗收：

- `grid: "5x2"` 的 prompt 與 `gen` 都使用 5×2。
- animated config 產生動畫 frame prompt，或得到清楚的 unsupported error。

### [ ] P2-03 — 多張組圖的 prompt 會重複內容，非角色模式仍要求「同一角色」

影響：CLI/Web 的非角色 24/32/40 張 prompt。

觀察：

- CLI 每張 sheet 都傳入同一份完整 `cellVariations`：`src/cli/commands/prompt.ts:33-50`。
- Web 雖會切 custom variations，但沒有 custom variations 時，每次 `buildSheetPrompt` 都從預設表情第 1 項重來：`web/src/ui/PromptTab.tsx:47-65`、`src/core/prompt.ts:169-180`。
- `isCharacter=false` 時，per-cell 標題仍寫「same character, different pose/expression」。
- 預設內容全部偏角色表情，與非角色物件/文字/風景包的用途矛盾。

影響：

- 24/32/40 張跨 sheet 會自動重複姿勢。
- 非角色路徑給出互相衝突的 prompt。
- LINE 建議一包內要有變化，這種重複會降低實用品質。

修正方向：

- 先產生整包的全域內容清單，再依 global offset 切給各 sheet。
- per-cell 說明與 defaults 依 `isCharacter` 分流。
- 非角色包提供物件/文字/場景 defaults，或要求使用者明確填 variations。

驗收：

- 不會因換 sheet 而從第 1 個動作重來。
- 非角色 prompt 不再出現「same character」，除非使用者明確要求。

### [ ] P2-04 — Schema 接受無效狀態，直到深層 runtime 才用無關錯誤失敗

影響：config load、prompt、切格、APNG、文字。

觀察：

- grid regex 接受 `0x8`：`src/config/schema.ts:25-29`。
- custom ladder 接受空陣列，frames 也沒有 LINE 上限：`src/config/schema.ts:53-78`。
- `package.count` 只要求正整數，沒有依靜態/動態限制為官方允許張數；`gen` 與 `prompt` 也不會在工作開始前擋掉 9、12 等張數。
- `processing.maxSize` 沒有限制 LINE 上限或偶數；CLI `parseSize` 也接受 `0x0`：`src/config/schema.ts:44-50`、`src/cli/util.ts:21-25`。
- text x/y 沒限制 0–100，outline width 可為負數：`src/config/schema.ts:8-17`。
- `cover` 可大於 count，最後被靜默 clamp，而不是指出設定錯誤。
- 顏色欄位只有 `string`；`parseColor` 沒先驗證所有字元都是 hex，像 `#0g0g0g`、`#f_0000` 會被部分解析成其他顏色：`src/core/color.ts:22-47`。
- Zod objects 沒有 strict，拼錯欄位會被默默移除並套預設。
- 探針確認 `grid: "0x8"`、`durationSec: 1.5`、`ladder: []`、text `[999,-20]` 全部 parse 成功；unknown fields 直接消失。
- CLI parser 使用 `parseInt`/`parseFloat` 且 override 用 truthy 判斷：`src/cli/index.ts:27-33`、`src/cli/commands/gen.ts:43-46`、`src/cli/commands/anim.ts:83-84`。實際執行 `prompt --count 8abc` 被當成 8；`--count 0` 被當成沒提供並沿用 config。
- `fitCanvas` 先把 canvas 限制到 `floorEven(bounds)`，又為容納 `ceilEven(scaled)` 把它放大：`src/pipeline/fitCanvas.ts:98-102`、`web/src/webpipe/fitCanvas.ts:50-53`。探針用 369×319 bounds 得到 320×320，超過指定高度。
- 空 ladder 進入 `encodeApngAutoFit` 後 `best` 仍為 null，最後以 `TypeError: Cannot read properties of null (reading 'colors')` 失敗：`src/pipeline/apng.ts:171-197`、`web/src/webpipe/apng.ts:169-192`。

修正方向：

- config object 使用 strict。
- grid 必須是正整數且容量足夠。
- ladder 不得為空；colors/frames 必須在合法範圍，min/max 要互相一致。
- count、cover、maxSize、duration、grid 容量要依 kind 做跨欄位驗證。
- text 座標與 outline 數值加範圍。
- CLI option parser 必須完整消費字串並檢查 finite/range，不能接受 `8abc`，也不能用 truthy 判斷是否有 override。
- 顏色先用完整 regex 驗證；fit 對 odd/custom bounds 要麼拒絕，要麼保證輸出不超界。
- 用 `superRefine` 集中檢查跨欄位規則。

驗收：

- 拼錯欄位時回報完整 config path。
- 不合法 count/grid/ladder/maxSize/color/text 在 load config 或 CLI parse 時就失敗。
- 任何 schema 接受的 config 都不會再走到上述 null crash。

### [ ] P2-05 — Frame 數沒有先檢查是否超過 sheet 容量

影響：CLI/Web 單組圖動畫。

觀察：

- `--frames` /「取前 N 格」沒有檢查 `count <= cols × rows`：`src/cli/commands/anim.ts:70-89`、`web/src/ui/AnimTab.tsx:105-122`。
- `extractCells` 會照 requested count 配陣列；超出的格會變透明 frame，不是明確 capacity error。
- 透明 frame 又會進入 P1-01 的內容盲區。
- CLI help 把 grid 寫成 `RxC`，parser 與其他地方實際都把第一個數字當 cols：`src/cli/index.ts:86-87`、`src/cli/commands/anim.ts:51-55`。

修正方向：

- decode/cut 前驗證 cols、rows、count 都是正整數，且 `5 <= count <= min(20, cols × rows)`。
- 全專案統一使用 `cols × rows`。

驗收：

- `--grid 4x4 --frames 17` 立即回 capacity error。
- zero、NaN、部分數字字串都不能被接受或默默忽略。

### [ ] P2-06 — 明知驗證失敗的檔案仍先被打包，Web 也照常提供「上架包」下載

影響：所有 CLI pack 與 Web pack/download。

觀察：

- CLI `build`、`gen`、動態整包都是先寫檔/ZIP，再驗證：`src/cli/commands/build.ts:66-92`、`src/cli/commands/gen.ts:123-145`、`src/cli/commands/anim.ts:183-208`。
- Web 也是先建 ZIP，再驗證；結果頁無論 validation 是否失敗，都顯示「下載上架包 zip」或 APNG：`web/src/ui/BuildTab.tsx:68-83`、`web/src/ui/SheetTab.tsx:107-121`、`web/src/ui/AnimTab.tsx:383-409`、`web/src/ui/packResult.tsx:21-35`。

不合理之處：

- 超標或不合法檔案仍使用成功/上架包語氣。
- 使用者很容易忽略 validation report，直接拿已知無效的 ZIP 上傳。

修正方向：

- 能提前驗證的內容先驗證，再建立正式 ZIP。
- 有 error 時禁用一般「上架包」下載；若需要診斷檔，放在明確的「仍下載無效結果」override。
- CLI 在 staging/temp 寫入，驗證成功才發布正式輸出。

驗收：

- validation error 不會出現一般成功訊息或一般上架包按鈕。
- 強制輸出的診斷檔清楚標示 invalid。

### [ ] P2-07 — `main.png`、`tab.png` 只驗尺寸，驗證不完整

影響：shared validation、靜態/動態整包。

觀察：

- `validateMain` 只檢查尺寸與動態 main 是否 APNG；`validateTab` 只檢查尺寸：`src/core/validate.ts:157-178`。
- 沒檢查 bytes、透明度、實際 PNG/APNG、動態 main 的 loops/frames/duration。
- LINE 規定每張圖片都必須小於 1MB 且背景透明。
- `animation.maxBytes` 可被設定成大於 1MB；動態 main 會使用這個非 LINE 上限，但 `validateMain` 仍不會報 bytes。

修正方向：

- shared core 定義 main/tab 完整規則，不只尺寸。
- 檢查格式、bytes、透明/內容、動態 main timing/loops/frames。
- 與 P1-06 一起確保 main 使用封面貼圖的實際動畫結果。

驗收：

- main/tab 超過 1MB 時失敗。
- main/tab 為空或不透明時失敗。
- 動態 main 必須是有變化、duration/loops 合法的 APNG。

### [ ] P2-08 — 動畫一律輸出 320×270，會為部分內容新增 LINE 明確要求避免的 margin

影響：Node/Web 所有動畫輸出與動態 main 的來源。

觀察：

- Node/Web 對每格都用 `mode: "exact"` fit 到 320×270：`src/pipeline/processAnimated.ts:72-87`、`web/src/webpipe/processAnimated.ts:70-85`。
- LINE 動態準則只要求不超過 320×270、至少一邊為 270，並明確要求不要新增/刪除 margin。
- 對正方形內容，現行流程會把主體縮到 270×270，再左右各補約 25px；原本使用 270×270 無 margin canvas 即可合法。

不合理之處：

- 固定最大矩形不是規格要求，且會主動建立不動的透明區域。
- 每格各自 exact-fit 也與 P1-07 的尺度跳動互相放大。

修正方向：

- 先對完整 frame sequence 算 shared union content bounds，再選最小合法偶數 canvas。
- 只有必要時才補透明區；不能為了統一寫死最大畫布。
- Node/Web 共用同一個 canvas planning 純函式。

驗收：

- 正方形序列可輸出 270×270，不會無故變成 320×270。
- 所有 frame 共用 canvas 且內容不被裁切，輸出仍符合一邊 270、最大尺寸與偶數規則。

### [ ] P2-09 — `normalize-sheet` 無法正確處理工作流明知會出現的 RGB/綠幕輸入

影響：`char-gen` 高密度動畫組圖修正流程。

觀察：

- `char-gen` 明確記錄 image generator 常交付 RGB-only，並把綠幕列為正式退路：`.claude/skills/char-gen/SKILL.md:61-69`。
- 同一文件遇到越格/多排縮小時叫使用者直接跑 `normalize-sheet.mjs`：`.claude/skills/char-gen/SKILL.md:33-37`。
- 腳本用 `sharp(IN).raw()` 讀取，沒有 `.ensureAlpha()`，卻把 buffer 固定當四通道並以 `data[p*4+3]` 當 alpha：`.claude/skills/char-gen/scripts/normalize-sheet.mjs:32-54`。
- 即使輸入是四通道不透明綠幕，整張背景仍是一個連通前景，演算法不會先 chroma-key/語意去背，無法得到「每格人物塊」。
- RGB 2×1 合成探針原本有兩個 30×40 色塊；腳本卻辨識成 `1×1` 與 `120×45` 兩塊並正常宣稱輸出，確認不是只會明確 crash，而是可能靜默重排錯誤。

不合理之處：

- RGB buffer 會以錯誤 stride 讀取；綠幕/不透明背景則讓 connected-components 的前提失效。
- 這兩種正是文件宣稱腳本要協助處理的常見產出，不是偏門輸入。

修正方向：

- 腳本開頭檢查 metadata/channel/background contract。
- RGB/opaque 輸入先走與 sticker-tool 相同的背景分析/去背，或明確拒絕並提供前置命令。
- 不要另外維護一套與 `src/core/cells.ts` 漂移的 component assignment。

驗收：

- RGBA transparent、RGB、green-screen 三種 fixture 都得到可解釋結果；不支援的背景立即報精確錯誤。
- 不會因 channel stride 錯誤靜默產出損壞 sheet。

### [ ] P2-10 — `gif-frames` 宣稱支援影片，但實作只處理 Sharp 可解碼的多頁圖片，且格數不足時會 crash

影響：GIF/影片動作對位圖工作流。

觀察：

- skill description 與流程反覆寫「GIF／影片」：`.claude/skills/gif-frames/SKILL.md:1-21`。
- 實際唯一入口是 `sharp(src, { animated: true })`，沒有影片 decoder、ffmpeg 或影片 frame extraction：`.claude/skills/gif-frames/scripts/gif-frames.mjs:67-95`。
- `--grid CxR` 把 `N` 設成格子容量；當 `N >= 來源格數 P`，`sampleIndices` 只回傳 P 個 index：`.claude/skills/gif-frames/scripts/gif-frames.mjs:46-50`。
- 後續組圖仍迴圈到 N，讀取不存在的 `cellBuffers[k]`：`.claude/skills/gif-frames/scripts/gif-frames.mjs:120-138`，因此來源格數少於 grid capacity 時會在 Sharp 深層失敗。
- 變速 GIF 只用所有 delays 的算術平均與 frame index 等距抽樣，不是依時間軸取樣：`.claude/skills/gif-frames/scripts/gif-frames.mjs:80-104`，會扭曲停頓與快動作比例。

修正方向：

- 若不支援影片，從 description/文件移除；若要支援，加入明確 decoder 與測試。
- grid 容量大於來源 frame 數時明確拒絕，或定義合法的補格策略。
- 以 cumulative timeline 取樣並回報實際選取的 delays，不用平均 delay 猜總長。
- 驗證 grid/cell/gutter/frames 為 finite 正整數。

驗收：

- MP4/MOV 要麼真的能處理，要麼在入口顯示「只支援 GIF/多頁圖片」。
- 少格來源不再讀 undefined；變速 GIF fixture 的關鍵停頓與總時間維持。

### [ ] P3-01 — 已宣告 72 dpi 規則，實際完全沒有收集或驗證

影響：shared spec 與全部 output encoder。

觀察：

- `STATIC_SPEC.minDpi` 已宣告：`src/core/spec.ts:20-24`。
- `ImageInfo` 沒有 density，validator 沒讀取 `minDpi`。
- Web encoder 沒有明確寫 PNG density metadata。

修正方向：

- 先確認 LINE uploader 是否要求檔內明確存在 density，還是缺 metadata 也可接受。
- 若要求，Node/Web 都要一致寫入並驗證 pHYs/density。
- 若實務上不要求，就移除未使用常數並記錄決策，不要宣稱有 enforce。

驗收：

- code 與文件只保留一個已驗證的 density 說法，不再有宣告但未實作的規則。

### [ ] P3-02 — 文字位置可被靜默裁掉

影響：CLI config 文字、Web 逐張疊字。

觀察：

- config 的 x/y 沒限制在文件所說的 0–100：`src/config/schema.ts:8-17`。
- Web 允許 0 與 100；但文字錨點是中心，填 0/100 會把半段文字放到 canvas 外：`web/src/ui/SheetTab.tsx:195-203`、`web/src/ui/AnimTab.tsx:501-509`。
- Node/Web 畫字前都沒有量文字 bbox：`src/pipeline/text.ts:80-107`、`web/src/webpipe/text.ts:29-55`。

修正方向：

- 驗證座標範圍。
- 量測文字加 outline 的 bbox；超出時自動夾回、警告，或要求明確開啟 allow-clipping。

驗收：

- 一般合法設定不會靜默切掉半段文字。
- 有意裁切必須明確選擇。

### [ ] P3-03 — 動畫 prompt/封面流程沒有落實「第一格要表達貼圖意涵」

影響：CLI/Web animation prompt、動態 main/tab 選圖。

觀察：

- LINE 細則要求第一格能表達該貼圖的動作或情緒，因為使用環境可能先顯示第一格。
- `buildFramesPrompt` 只要求時間順序與首尾循環，沒有要求第一格具代表性：`src/core/prompt.ts:191-209`。
- main/tab 固定取動畫第一格/第一段衍生，UI 沒有提供另選代表 frame 或警告。
- `anim-set` 多數 storyboard 第一格刻意設成中性起點，更容易讓封面看不出揮手、點頭、大笑等意涵。

修正方向：

- prompt 要求第一格本身可辨識情緒/動作；循環設計不能把唯一有意義的 peak 藏在中段。
- 或允許指定 cover frame，但仍要確認 LINE 對實際第一格的要求，不可只改 tab。
- 加 prompt snapshot 與代表 frame UX。

驗收：

- 預設動畫 prompt 明寫第一格要求。
- 每段動畫在產 main/tab 前可確認第一格能表達意涵。

### [ ] P3-04 — 專案範例 config 示範只有三格的動畫，照抄必定不合法

影響：`init`、`examples/sticker.config.yaml`、`line-sticker-pack` 參考文件。

觀察：

- CLI 產生的範例寫 `frames: [wave1.png, wave2.png, wave3.png]`：`src/cli/commands/init.ts:58-63`。
- repo 範例同樣只列三格：`examples/sticker.config.yaml:48-53`。
- `line-sticker-pack` reference 也使用三格：`.claude/skills/line-sticker-pack/references/sticker-tool.md:85-98`。
- LINE 與本工具 validator 都要求至少五格；範例不是省略號語法，使用者照抄會在 processing 時失敗。

修正方向：

- 範例至少列五個 frame，或用註解清楚標記必須展開為 5–20 格。
- 加測試保證 `init` 產出的所有 active/example workflow 能通過 schema 與最小跨欄位規則。

驗收：

- 新使用者照 `init`/reference 建立的動畫 frames 清單不會因少於五格立即失敗。

## 需要產品決策的風險

以下是實際限制，但在需求定案前不列為確定 bug。

### R1 — 分離的道具/愛心/文字可能被分到錯格

`extractCells` 只能完整保留「仍與主體連通」的越線元件。分離的愛心、閃光、標點、道具零件會依自己的 centroid 或最近大元件分格：`src/core/cells.ts:355-411`。

可選方向：

- 保留確定性 heuristic，但縮小「不會切錯道具」的宣稱。
- 對模糊的小元件顯示 confidence warning。
- 提供手動把 component 改分到另一格的 UI。

## 已逐項檢查、未發現重大不合理處

- 靜態/動態包張數、最大尺寸、loops 範圍、frame 範圍、單圖 bytes、ZIP bytes 常數與目前官方表格一致。
- `01.png` 起的命名、`main.png`、`tab.png`、ZIP entry 選擇是確定且合理的。
- Node APNG 會改寫 `acTL.num_plays`、重算 CRC，並在編碼後回讀 metadata。
- 靜態 PNG byte fitting 與動畫色數/格數 ladder 的概念合理；問題在控制欄位及最終結果沒有正確傳遞。
- 靜態 fit 預設會產偶數尺寸並保留建議 10px margin。
- shared core 目前仍保持平台中立。
- Web 圖片處理在本機完成；應有的網路請求是同站背景移除 model/WASM 資源。
- CLI output dir 可殘留舊 loose files，但新 ZIP 只放本次檔案；目前文件也已明確說明。

## 建議修正順序

1. 先修 compliance model：P1-01、P1-02、P1-03、P2-07、P2-08。
2. 阻止內容被改壞：P1-04、P1-07。
3. 讓 APNG 最終結果一路一致：P1-05、P1-06。
4. 修通對外承諾的動畫流程：P1-08、P2-09、P2-10。
5. 關閉無效輸入/輸出路徑：P2-04、P2-05、P2-06。
6. 對齊公開設定與 prompt：P2-01、P2-02、P2-03。
7. 最後處理 P3 與產品決策 R1。

## 最小探針證據

探針直接跑目前 source 且全在記憶體內；沒有把 build 成功當判準。

| 探針 | 實際結果 |
|---|---|
| 全透明靜態輸入 | 產出 320×320 PNG；validation `ok: true`。 |
| 全不透明但有 alpha channel 的 metadata | 靜態 validation `ok: true`。 |
| 五格、1.5 秒 APNG | delays `[300,300,300,300,300]`；validation `ok: true`。 |
| 合法要求 1 秒、6/7/11 格 APNG | 實際 delays 總和分別為 1002/1001/1001ms。 |
| 五張完全相同 frame | 編成五格 APNG；validation `ok: true`。 |
| `autoFit: false`、十格輸入、五格 ladder | 最終編五格，卻回傳十個 `fittedFrames`。 |
| 封面貼圖 10 fps | 貼圖 500ms，main 2000ms。 |
| frame-sheet 垂直移動 | 輸入 tops `[10,25,40,25,10]`，抽格後 `[0,0,0,0,0]`。 |
| 來源 canvas 寬度交替 100/200 | fit 後主體寬度交替 55/33px。 |
| 空 custom ladder | runtime `TypeError`：從 `null` 讀取 `colors`。 |
| CLI `prompt --count 8abc` | 成功執行並當成 8。 |
| CLI `prompt --count 0` | 0 被忽略，靜默沿用 config count。 |
| `fitCanvas` bounds 369×319 | 實際輸出 320×320，超過指定高度。 |
| 非法顏色 `#0g0g0g` / `#f_0000` | 沒有拒絕，分別被解析成其他 RGB。 |
| RGB 2×1 sheet 跑 `normalize-sheet` | 兩個 30×40 主體被誤判成 1×1 與 120×45，仍正常輸出。 |

## 本審查的完成定義

這份檔案已完成「診斷與列問題」，沒有修改 application behavior。每個 checkbox 都應視為獨立 implementation task，只有同時符合以下條件才能關閉：

1. 先有能在目前實作失敗的 focused regression test。
2. 只修改真正受影響的 shared core / Node / Web 邊界。
3. 用使用者實際 workflow 驗證行為，不以 typecheck/build 通過取代。
