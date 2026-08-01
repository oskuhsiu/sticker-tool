---
name: anim-set
description: 一鍵動態圖組——使用者丟入一張「多視角角色 master」（六視圖／turnaround），就用內建「動作庫」（數十個預先寫死分鏡的動作）批量產出一組動態貼圖 APNG，一個動作一個檔。當使用者想「用一個角色一次做出一整組會動的貼圖」「把這張角色圖套到很多動作上出動圖」「一鍵動圖組」，或給了角色六視圖要批量產動態貼圖時用它。產圖細節靠 codex（內建 char-gen 方法論）、切格組 APNG 靠 sticker-tool CLI；本 skill 只負責「動作庫 + 批次編排 + 自動偵測壞 sheet 重 roll」。只做動圖；單張靜圖不走這裡。要打包成 LINE 上架包另交 line-sticker-pack。
allowed-tools: Bash(codex:*), Bash(npm:*), Bash(node:*), Read
---

# anim-set：一鍵動態圖組

## 一個核心信念（先讀這個）

**這個 skill 把「動作設計」固化進資料、把「產圖判斷」降成模板套用。**

做一組動態貼圖的瓶頸，從來不是切格或編碼（那些 sticker-tool CLI 已經確定性地做完），而是**每個動作要逐格手寫分鏡**——那是 char-gen 互動式、要人盯著確認的活。本 skill 的支點是 `data/action-library.yaml`：**數十個動作的逐格分鏡預先寫死、驗證過一次**，之後換任何新角色，只是把 codex 的 `-i` 換成新 master。於是「一個角色 → 一整組動圖」變成跑一個 batch。

所以你（agent）的工作不是「設計動作」，而是**編排**：

```
char-gen（產／建立多視角 master）
   └─> anim-set（master + 選定動作 → 一組獨立動態 APNG）   ← 你在這裡
          └─> line-sticker-pack（要上架時，挑 8/16/24 個打包成 LINE 包）
```

兩件事不歸你，別越界：
- **角色長相** → 由 master 這張參考圖在守（codex `-i`）。你不描述角色五官，只填動作庫已寫好的姿勢＋表情。畫歪了回頭修 master 或該格，不要靠文字硬凹。
- **打包成 LINE 規格上架包** → 那是 line-sticker-pack。本 skill **刻意不打包**：輸出一組獨立 APNG，不受 8/16/24 張數約束。

## 誠實的期待（先說在前面）

- **「一鍵」≠「一鍵就完美」。** 產圖必經 codex 內建 image_gen，它不穩：有時只給 RGB 不給 alpha、角色會漂移、人物越過格線、自行去背把白衣／眼白挖洞。所以流程是**批次 + 自動偵測壞 sheet → 點名重 roll**，不是產完就交。
- **這是個跑數十分鐘的 batch job。** N 個動作 = 至少 N 次 codex 呼叫（加重 roll 更多）。先用「單動作試跑」收斂風格與透明率，再批量；別一次梭哈。
- **輸入假設＝已是插畫／卡通風的多視角 master。** 寫實照片風角色做貼圖式誇張動作（比心、大哭）天生容易恐怖谷（char-gen method.md 第 5 節）。使用者若只有真實照片，先引導用 **char-gen 模板 A** 產一張插畫風 turnaround master 再進來。

## 流水線

### ① 定盤——問清或合理預設

| 決策 | 預設 |
|---|---|
| master 路徑 | 必填，使用者提供的多視角 turnaround（絕對路徑） |
| 要哪些動作 | 預設＝動作庫全部；可給 id 子集（如 `wave nod love`） |
| 輸出目錄 | `<out>`（預設 `out/anim-set`） |

讀 `data/action-library.yaml`，過濾出選定動作。**載入時逐一校驗硬約束**（不過就跳過該動作並回報，別硬跑）：
`5 ≤ frames ≤ 20`、`cols*rows ≥ frames`、`storyboard.length === frames`、`loops × durationSec ≤ 4`。

**抽 signature features（每張 master 做一次，所有動作共用）**：動作庫是跨角色通用的，鎖角色身分的責任在這裡。用 `Read` 看一眼 master，照 char-gen 方法（`../char-gen/references/method.md` 第 1 節）找出 **2–4 個最獨特、最難被模型猜錯的特徵**（痣、異色瞳、特定印花、髮型細節…），外加一句畫風描述。這組 signature features ＋畫風是**抗漂移的主力**，會原封不動寫進每個動作的 LOCK；只抽一次、批次內所有動作重用。

### ② 組 codex prompt——套 char-gen 五段骨架

每個動作組一份，寫進 `/tmp/anim-set-<id>.txt`（避免 shell 引號地獄）。骨架見 `../char-gen/references/method.md` 第 2 節；逐格分鏡見第 5 節；輸出硬規則見 `../char-gen/SKILL.md`〈輸出硬規則〉。填法：

- **[REFERENCE]**：使用 `-i` 帶入的角色 turnaround master 為唯一身分基準。
- **[LOCK]（每張 master 固定）**：臉型／五官比例／髮型髮色／體型／年齡感／畫風與參考圖完全一致；**逐一列出 ① 抽出的 2–4 個 signature features**（這是抗漂移主力，每個動作照抄同一份）；**取 `{view}` 視角、以 `{viewExpressionBase}` 表情當對齊基準**（多視角 master 必寫，否則 codex 不知對齊哪個）。
- **[TASK]**：填入 `meta.outputContract`（把 `{grid}`、`{frames}` 換成該動作值——含背景優先序、gutter／越格／錨點、執行規則防呆；8×2 的整張解析度／每格尺寸已寫在 contract 內），**結尾硬寫檔名**：`存成當前工作目錄下的 <id>.png，PNG`。（解析度別自己硬塞「每格 ≥320px」：8 欄時 codex 寬度上限 ~1920 ÷ 8 ≈ 240px/格，要求 320 反而逼它破壞 2.3:1 外框；切格後 fit 會downscale 到 320×270，240px/格夠用。）
- **[VARIATION]**：`動作主題＝{nameZh}，{frames} 格{loop ? "循環（終點順接起點）" : ""}，每格明確如下：` 後接逐行 `格N：{storyboard[N-1]}`。
- **[NEGATIVE]（固定＋專屬）**：不改臉型／髮長／年齡／畫風、不增刪 signature features、不加文字浮水印、不畫背景（留透明）；再加該動作的 `negativeLock[]`。

### ③ 跑 codex → 驗檔 → 切格組 APNG

**所有指令都在專案根目錄 `/Users/apple/Projects/fun-tools/sticker-tool` 跑**（`npm run sticker` 與兩個 node 腳本都靠根目錄的 `node_modules` 解析 sharp/upng-js／yaml；腳本用根目錄相對路徑呼叫）。對每個動作（可序列；codex 本就一次跑一張）：

```bash
# a. 產 frames-sheet（codex 指令骨架同 char-gen/SKILL.md）
codex exec -i <master> -s workspace-write \
  -c sandbox_workspace_write.network_access=true \
  -C <out>/_sheets --skip-git-repo-check "$(cat /tmp/anim-set-<id>.txt)"

# b. 驗檔：codex 自稱完成 ≠ 檔在工作目錄（image_gen 預設存到 ~/.codex/generated_images/<session>/）
#    <out>/_sheets/<id>.png 不在就去 generated_images 按 session 撈出來 cp（char-gen 已知陷阱）
#    產完把 prompt 嵌進 PNG 可追溯（重用 char-gen 腳本）：
node .claude/skills/char-gen/scripts/png-prompt.mjs embed <out>/_sheets/<id>.png /tmp/anim-set-<id>.txt

# c. 切格＋穩定化＋APNG（確定性 CLI；單組圖模式自動 grid 對齊、關 anchor 穩定化）
npm run sticker -- anim --sheet <out>/_sheets/<id>.png --grid <grid> \
  --frames <frames> --duration <durationSec> --loops <loops> \
  --out <out> --name <id>
```

CLI 會印出**切格分析報告**（背景型態、對齊縫命中率、空格、越格、場景漂移修正）與**動態規格驗證**（≤1MB、一邊 ≥270、格數 5–20、loops 1–4）。

### ④ 自動偵測壞 sheet → 判 good / reroll / 放棄

**讀 ③c 印出的報告**（不要看拼貼圖手調），再跑鬼影偵測腳本，照下表判定：

| 壞徵狀 | 報告/腳本訊號 | 判定 |
|---|---|---|
| 空格／漏畫／切錯位 | 報告 `空格（n）：#k` | 任一空格 → **reroll** |
| 網格不符（會逐格漂移） | 報告 warning「組圖約為 a×b 與指定不符」 | 出現 → **reroll**（非調參能救） |
| 找不到乾淨透明縫 | 報告「參照切線對齊縫 直 x/n｜橫 y/m」命中率 | 命中率 < 60% → **reroll**（主體越格沒留 gutter） |
| 越格 | 報告「越出參照格線 #k(+px)」 | 元件式抽格不切斷，輕微容忍；多格普遍且 +px 很大 → reroll |
| 假透明／RGB-only | 報告背景 = 「不透明…（語意去背）」 | opaque 本身**不一定** reroll（CLI 已 @imgly 救回）；opaque **且**（有空格 or 鬼影超標）才 reroll；綠幕一律接受 |
| 鬼影／半透明挖洞 | `node .claude/skills/anim-set/scripts/ghost-check.mjs <out>/<id>.png` 回傳 `anyFlag:true`（逐格量 alpha∈[40,220] 佔比；用 upng-js 解 APNG） | 任一格半透明佔比 ≥ 3% → **reroll** |
| 規格不過 | `reportValidation('動畫', …)` 失敗（超 1MB／一邊 <270／格數） | 多半 autoFit 會壓；仍不過先調 `--duration`/`--loops` 重跑 CLI（不重 roll codex），無效再 reroll |

**reroll 策略**：
- **每動作最多 reroll 3 次**（codex「連三張固定 RGB」是實測上限；3 次後多半是該動作構圖本身難搞）。
- **用 char-gen 模板 C 點名、不重頭描述**：把判定出的壞格＋徵狀寫進修正 prompt（例：「格3 偵測到半透明手臂→畫成不透明實心」「格5 空白→補畫該格」「主體越過格頂→縮到佔格 75%」「整張只給 RGB→改輸出真透明 0x00，退路綠幕不自行去背」），其餘維持上一張。再跑 ③ 同一動作。
- **放棄**：超過上限仍壞 → 把最後一張 sheet 與壞徵狀記錄移到 `<out>/_rejects/<id>_r<n>.png`，摘要標 `FAILED(原因)`，**不阻塞其他動作**。

### ⑤ 摘要

全部跑完印一張表：`動作 | 狀態(OK/FAILED) | roll 次數 | 尺寸 | KB | 格數`。FAILED 的列原因交人看（回 char-gen 修 master，或人工調動作庫該動作的分鏡）。

## 兩個省成本的開關（務必先用）

- **dry-run**：只組 prompt 印出來、不跑 codex。先人工確認五段骨架、逐格分鏡、背景硬規則、檔名解析度都對。零成本。
- **單動作試跑**：先只跑 1 個代表動作（如 `wave`），確認風格／透明率／角色一致都 OK，再批量其餘。呼應 line-sticker-pack「別一次梭哈」。

## 輸出佈局

```
<out>/
  _sheets/<id>.png      # codex 產的 frames-sheet（已嵌 prompt）
  <id>.png              # 最終動態 APNG（一動作一檔）← 交付物
  _rejects/<id>_r<n>.png # 重 roll 上限仍壞的，連同原因留存
```

## 邊界（理解了就不會越界）

- **不自己呼叫 char-gen skill**：char-gen 是互動式、會「列分鏡給使用者確認再跑」，批次跑數十個動作不能每個都停。動作庫已把分鏡預先寫死＝把 char-gen 的判斷固化進資料；自己組 prompt 才能精確掌控檔名／格數／grid／reroll 點名什麼——那是批次＋重 roll 的命脈。但**方法論直接重用** char-gen 的五段骨架／輸出硬規則／模板 C（依據見 `../char-gen/`），不要自創一套。
- **不改 sticker-tool CLI**：切格／穩定化／APNG／規格驗證都用既有 `anim --sheet` 確定性流程。品質判定靠讀它印出的報告。
- **前置（建 master）仍走 char-gen**：本 skill 從「已有多視角 master」接手。

## 何時不要用這個 skill

- 只要產一張／一組**靜態**貼圖 → 這 skill 只做動圖；靜態用 char-gen + sticker-tool `gen --sheet`。
- 只要產一段動圖、不是「一個角色套很多動作的一整組」 → 直接 char-gen 產一張 frames-sheet ＋ `anim --sheet`，不必走批次。
- 要打包成 LINE 上架包（8/16/24、main/tab、zip、規格驗證）→ 把選好的若干 APNG 交給 line-sticker-pack `anim --config` 整包模式。
- 使用者只有真實照片、且堅持寫實風做誇張動作 → 先講清楚恐怖谷風險，建議轉插畫風 master。
