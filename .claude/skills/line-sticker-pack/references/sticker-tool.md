# sticker-tool 參考：設定檔、CLI、LINE 規格、疑難排解

SKILL.md 講「怎麼指揮」；這份給你「確切的欄位、指令、規格、修法」。
專案根目錄：`/Users/apple/Projects/fun-tools/sticker-tool`。CLI 用 `npm run sticker -- <子指令>` 跑（開發），或 `npm run build` 後用 `sticker-tool`。

## 目錄
1. CLI 子指令速查
2. 設定檔完整欄位
3. LINE Creators Market 規格（已寫死為驗證常數）
4. 疑難排解：驗證失敗 → 對症下藥

---

## 1. CLI 子指令速查

| 指令 | 用途 | 輸入 |
|---|---|---|
| `build <inputDir>` | 本機個別圖 → 靜態包 | 一個目錄，每張一個檔（**不經 char-gen**） |
| `gen --config --sheet` | 現成組圖切格 → 靜態包 | char-gen 產的組圖（可多張 `--sheet`） |
| `anim --config` | 整包：本機連續影格 → 動態 APNG 包 | 影格路徑寫在 config 的 `stickers[].frames` |
| `anim --sheet --grid` | 單段：一張 frames-sheet → 一段動畫 APNG | char-gen 的單段動作組圖（自動切格＋穩定化） |
| `prompt --config` | 只印產圖 prompt（mobile/半自動，不呼叫任何產圖） | — |
| `init` | 產生範例設定檔 | — |

**重點：`gen`／`anim` 都不再呼叫 codex**；AI 產圖一律先由 char-gen 完成，CLI 只做確定性打包。
切格（`gen` / `anim --sheet`）會**自動偵測背景→去背→吸到真實透明縫→切完校正**並印報告，不需人工指定切線或先去背（見「3.5 切格自動分析」）。

常用旗標：
- `gen`：`--config <file>`（必）、`--sheet <path>`（可重複，每張版面一個，相對 CWD）、`--out <dir>`、`--count <n>`（覆寫）、`--name <str>`。
- `anim`（整包）：`--config <file>`（必）、`--out <dir>`、`--count <n>`、`--name <str>`。
- `anim`（單組圖）：`--sheet <path>`（相對 CWD）、`--grid <RxC>`（如 4x4）、`--frames <n>`（取前 N 格）、`--duration <sec>`、`--loops <n>`、`--out`、`--name`、選配 `--config`（取其 animation/removeBackground）。
- `build`：`<inputDir>`（必）、`--count <n>`（必）、`--out`、`--name`、`--no-remove-bg`、`--stroke --stroke-width --stroke-color`、`--max-size WxH`、`--cover <n>`。

`--sheet` 張數必須等於版面 `sheets` 數：角色包恆為 1 張（單張組圖）；非角色大組圖才可能多張。

---

## 2. 設定檔完整欄位（YAML，經 zod 驗證）

```yaml
package:
  name: "My Stickers"      # zip 檔名
  count: 8                 # 靜態 8/16/24/32/40；動態 8/16/24
  animated: false          # 可省；設 true 或任一 sticker 有 frames → 動態包

source: ai                 # ai（char-gen 產）| local（本機，走 build）

ai:                        # 影響切格與 prompt 指令；產圖本身已交 char-gen
  style: "flat cartoon, bold black outline, soft pastel palette"
  transparent: true        # 預期 char-gen 輸出透明 PNG
  isCharacter: true        # true→走角色一致性版面門檻（8 好/16 警告/≥24 擋）
  grid: auto               # auto（由 count 推 rows×cols）| "4x2"（須容得下 count）
  reference: ref.png       # 選填；相對設定檔目錄（給 char-gen / prompt 提示用）
  crop: equal              # equal | equal+rembg（切格後逐格再去背補刀）
  forceOversizeSet: false  # 角色包 >16 張要 true 才放行（接受降質）
  cellVariations:          # 選填；逐格表情（給 prompt 指令與文件對齊用）
    - "happy waving"

processing:
  removeBackground: auto   # 省略時 local→true、ai→false；auto=偵測殘留才補刀；亦可 true/false
  stroke:
    enabled: true
    width: 8
    color: "#ffffff"
  maxSize: [370, 320]      # 省略時用該 kind 規格上限（靜態 370×320 / 動態 320×270）

cover: 1                   # 用第幾張產 main/tab（1-based）

animation:                 # 動態包才生效
  maxBytes: 1000000        # ≤1MB
  loops: 1                 # 1–4（不可無限）
  durationSec: 2           # loops × 單輪 ≤ 4 秒
  autoFit: true            # 超標自動降色階至達標
  priority: balanced       # colors | frames | balanced（超標時優先保誰）
  minColors: 16
  minFrames: 5
  ladder: auto             # 或自訂 [{colors, frames}, ...]
  stabilize:               # 主體穩定化：殺連續影格的「跨格漂移」（預設開）
    enabled: true
    anchor: head           # head（上半部暗+不透明質心；深髮角色＋淺/透明底準）| centroid | none
    axis: xy               # x（只水平）| xy
    darkThreshold: 70
    topFraction: 0.5       # 只在上半部找錨點，避開印花/手/道具

stickers:                  # 逐張覆寫；stickers[i] ↔ 第 i+1 格（順序務必對上）
  - text:                  # 疊字（選填）
      content: "嗨～"
      x: 50                # 0–100，畫面百分比
      y: 88
      size: 40
      color: "#000000"
      font: "/abs/path/NotoSansTC-Bold.otf"   # 給 .otf/.ttf 路徑最保險；家族名走 fc-match
      outlineColor: "#ffffff"  # 選填，文字白邊
      outlineWidth: 4
  - frames: ["f01.png", "f02.png", "f03.png"]  # 動態：char-gen 產的影格（相對設定檔目錄）
    fps: 10
    motion: "waving"       # 選填，給 char-gen 的動作描述（文件對齊）
```

**路徑解析鐵則**：`stickers[].frames`、`text.font`、`ai.reference` 相對**設定檔所在目錄**；CLI 的 `--sheet/--out/--config` 相對**當前工作目錄**。混淆會出現「找不到檔」。

---

## 3. LINE Creators Market 規格（驗證常數）

| | 靜態 | 動態（APNG） |
|---|---|---|
| 單張尺寸 | ≤ 370×320 | ≤ 320×270，且**一邊 = 270** |
| 長寬 | 偶數、透明 RGBA | 偶數、透明 RGBA |
| 單檔 | ≤ 1MB | ≤ 1MB、影格 5–20、循環 1–4 |
| 張數 | 8 / 16 / 24 / 32 / 40 | 8 / 16 / 24 |
| main.png | 240×240 靜態 | 240×240 **APNG** |
| tab.png | 96×74 靜態 | 96×74 **靜態** |
| 整包 | zip ≤ 60MB；靜態與動態**不可混包** | 同左 |

---

## 3.5 切格自動分析（gen / anim --sheet 都會跑，不需人工微調）

codex 交付的組圖**幾乎都不是乾淨等分網格**：尺寸不整除（1254÷4=313.5）、模型把格線畫歪、主體舉手外溢，且**多半不透明**（綠幕／近白平塗／把透明棋盤畫成實體像素）。所以切格**不再死切 1/n**，而是先用程式分析該怎麼切、切完再校正，全部算出來：

1. **偵測背景**：取邊框樣本判 `transparent` / `green` / `opaque`。
2. **去背成透明前景**（為了量得出格間透明縫）：`green`→色鍵 chroma key＋despill（即時精準）；`opaque`→@imgly 整張語意去背（白衣白底分得開，色鍵做不到）；`transparent`→原樣。**切出的格已去背，下游不必再逐格去背。**
3. **吸附到真實透明縫**：由前景占用剖面，把每條等分線吸到附近最空的縫（gutter）中心；找不到縫（主體塞滿）的線退回占用最小處並標記。
4. **切完校正**：逐格量「前景占比、沿內部切線的跨越量」，pad 成統一大小。

CLI 會印出**算好的報告**，照數字判斷即可（不要看拼貼圖手調）：

```
背景：不透明 rgb(248,248,248)（語意去背）
切線品質（越低越好）｜直：成本 0.000、對齊縫 3/3｜橫：成本 0.001、對齊縫 3/3
校正：每格主體完整、無空格
```

- **成本**＝切線穿越主體的量（occ/peak），0＝切在乾淨縫、越高＝切穿越多主體；**對齊縫 N/M**＝M 條內部線有 N 條吸到真實透明縫。成本低且 N=M → 切得好。
- **「找不到乾淨透明縫」警告** → 主體被畫到頂天立地、格間沒留縫（char-gen 構圖問題）；工具已取傷害最小處切，但要更好就**回 char-gen 讓主體佔格約 75–80%、留明顯 gutter**。
- **「空格」警告** → 某格幾乎沒主體（切錯位或 char-gen 漏畫該格）。
- **「背景非透明」警告** → 已用語意模型救回；最乾淨仍是請 char-gen **直接產透明底**（尤其有飛出愛心等分離前景時，雖然實測 @imgly 多半留得住鮮明色塊）。

> 這些都是**程式量出來的數字**，目的就是讓你（agent）不必盯著切格拼貼圖猜——照報告對症下藥。

---

## 4. 疑難排解：驗證失敗 → 對症下藥

CLI 結尾會印逐項驗證。先判斷是「**打包問題**（調參重跑 CLI）」還是「**畫面問題**（回 char-gen 重產該格）」。

| 症狀 | 多半原因 | 修法（不必重畫） |
|---|---|---|
| 靜態超 370×320 | 描邊太粗 / maxSize 太大 | 降 `processing.stroke.width`、設較小 `maxSize` |
| 單張超 1MB（靜態） | 細節太多 | 已有自動減色；仍超標就縮 `maxSize` |
| 動態超 1MB | 影格×色數太高 | 確認 `autoFit: true`；降 `minColors`/`minFrames`；`priority: colors` 或 `frames` |
| 動圖人物左右漂移/抖動 | codex 逐格主體未對齊 | 預設 `animation.stabilize` 已殺；非深髮角色改 `anchor: centroid`；仍抖檢查影格是否同尺寸 |
| 動圖背景（白塊邊緣）甩動 | 平移填補色與背景不符 | 穩定化已自動「比照背景填補」（取四角色），白底不必去背；**勿為此硬去背**——@imgly 會把飛出愛心等分離前景當背景吃掉 |
| 動態尺寸不對（無一邊 270） | — | 由 fit 流程保證；若失敗檢查影格是否全同尺寸 |
| 長寬非偶數 | — | fit 會取偶數；通常不會發生，發生就回報 |
| 殘留背景／白邊 | codex 交不透明（綠幕/近白/假棋盤） | **切格已自動去背**（綠幕→色鍵；近白/實底→@imgly 語意去背，保白衣）；仍殘留才設 `processing.removeBackground: true` 補刀 |
| 張數不符 | 切出的格數 ≠ count | 對齊 `count`、`grid`、組圖實際格數 |
| 切格切到主體/錯位 | grid 不符、或 codex 主體外溢越格線 | 切格已自動「偵測背景→去背→吸到真實透明縫」（見下「切格自動分析」）；看報告「對齊縫 N/M」「找不到乾淨透明縫」判斷——仍錯就設明確 `ai.grid`，或回 char-gen 讓主體不越格線 |
| 疊字變豆腐／報字型錯 | 找不到字型 | 給存在的 `.otf/.ttf` 絕對路徑 |

**畫面問題**（臉變成不同人、臉被手遮、風格跑掉）→ 不是 CLI 能修的，回 [char-gen](../char-gen/references/method.md) 用「修正模板（C）」點名重產，再重跑打包。

> 區分兩種「漂移」：動圖**人物左右位置漂移**（跨格沒對齊）是**打包問題**，由 `animation.stabilize` 確定性修好、不必重畫；char-gen 管的是**身分**一致性（臉是不是同一個人）。
>
> 透明底取捨：白底素材要轉透明，@imgly 會把**飛出愛心等分離前景**當背景吃掉；要透明請 char-gen 直接產透明底（`transparent: true`），別事後硬去背。
