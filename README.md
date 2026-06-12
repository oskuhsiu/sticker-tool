# sticker-tool

把原圖（本機照片或 AI 生成）自動處理成符合 **LINE Creators Market** 規格、可直接上架的貼圖包。
去背 → 裁切置中 → 縮放 → 描邊 / 疊字 → 打包（含 main/tab/序號圖 + zip），靜態與動態（APNG）皆支援。

> CLI 為初期形態；純邏輯核心（`src/core/`）平台無關，未來可搬到 mobile（React Native）重用「產 prompt」那層。

## 功能

- **產圖與打包解耦**
  - **AI 產圖交給 [char-gen](.claude/skills/char-gen) skill**（codex 內建 `image_gen`；角色包單張組圖、單次產完保證同一人）。本 CLI 不自帶 codex 產圖，只吃現成圖。
  - 整條「產圖 → 打包」由 [line-sticker-pack](.claude/skills/line-sticker-pack) skill 指揮；CLI 是底層的確定性打包器。
  - `local`：本機圖片，用免費本地模型（@imgly）去背，直接走 `build`。
- **組圖 → 切格**：一張大圖含多格貼圖，由目標張數自動決定 rows×cols；等分切格（`equal`）或切後補去背（`equal+rembg`）。
- **規格自動修復**：等比縮放置中、偶數長寬、10px 邊距、單張壓到 ≤1MB（靜態減色 / 動態降色階）。
- **白色描邊**（可開關）、**疊字**（SVG，字型 base64 內嵌，中文不會變豆腐）。
- **動態貼圖 APNG**：連續影格 → APNG，循環 1–4 次（非無限），auto-fit 到 ≤1MB（多數情況保全影格）。
- **完整上架包**：`main.png`（動態包為 APNG）、`tab.png`、`01.png…` 序號圖、`.zip`，並逐項驗證 LINE 規格。

## 網頁版（GitHub Pages）

CLI 功能（除 AI 產圖外）已有**純靜態網頁版**：[`web/`](web/)。瀏覽器內完成去背（onnx wasm）、
切格、fit、描邊、疊字、APNG、打包驗證，圖片不離開裝置；`prompt` 功能變成「產圖 Prompt」分頁，
接任何外部 AI 產圖工具補上產圖環節。push `master` 後由 GitHub Actions 自動部署
（Settings → Pages → Source 選 GitHub Actions），詳見 [web/README.md](web/README.md)。

## 安裝

需 Node.js ≥ 20。AI 產圖由 char-gen skill 透過已登入的 [codex CLI](https://github.com/openai/codex) 完成（吃 codex 自身登入，**不需** OpenAI API key）；只做本機圖片打包則不需 codex。

```bash
npm install
```

CLI 透過 `npm run sticker -- <args>`（開發）或 build 後的 `sticker-tool` 執行。下文以 `sticker-tool` 代稱。

## 使用

### 本機圖片 → 靜態貼圖

```bash
sticker-tool build <輸入圖目錄> --count 8 --out out --name "My Pack"
# 選項：--no-remove-bg（不去背）、--stroke --stroke-width 8、--max-size 370x320、--cover 1
```

### AI 產圖 → 靜態貼圖（兩步：先產圖、再打包）

```bash
sticker-tool init                              # 產生 sticker.config.yaml 範例
# 1) 用 char-gen skill 產一張透明組圖（如 out/_sheets/sheet_01.png）
# 2) 切格 + 打包現成組圖（--sheet 一張版面給一個，相對 CWD）：
sticker-tool gen --config sticker.config.yaml --sheet out/_sheets/sheet_01.png --out out
```

> 整段流程（產圖 → 寫 config → 打包 → 驗證）可交給 `line-sticker-pack` skill 一手指揮。

### 動態貼圖（APNG）

```bash
# 影格一律來自本機路徑（每個 sticker 在設定檔給 frames: [...]）。
# AI 影格先用 char-gen skill 產出 frame_01.png…，再把路徑寫進 config：
sticker-tool anim --config anim.config.yaml --out out
```

### 只產 prompt（mobile / 半自動）

```bash
sticker-tool prompt --config sticker.config.yaml   # 輸出產圖 prompt，自行貼到外部工具
```

## 設定檔

`sticker-tool init` 會產生帶註解的範例。重點欄位：

```yaml
package: { name: "My Stickers", count: 8 }   # 靜態 8/16/24/32/40；動態 8/16/24
source: ai                                   # ai | local
ai:
  style: "flat cartoon, bold black outline, pastel palette"
  transparent: true        # 請 codex 直接輸出透明背景
  isCharacter: true        # 角色包→單次單張組圖（保證同一人）
  grid: auto               # auto | "4x2"
  crop: equal              # equal | equal+rembg
  forceOversizeSet: false  # 角色包 >16 張須開啟才允許（接受降質）
processing:
  removeBackground: auto   # 省略時 local→true、ai→false；auto=偵測殘留才補刀
  stroke: { enabled: true, width: 8, color: "#ffffff" }
animation:                 # 動態包
  loops: 1                 # 1–4（不可無限）
  durationSec: 2           # loops × 單輪 ≤ 4s
  autoFit: true            # 超標自動減色至 ≤1MB
stickers:                  # local 或逐張覆寫（疊字 / 動態影格）
  - frames: [a.png, b.png, c.png]
    fps: 10
    text: { content: "嗨", x: 50, y: 88, size: 40, color: "#000", font: "/path/Noto.otf" }
```

## LINE 規格（已寫死為常數驗證）

| | 靜態 | 動態（APNG） |
|---|---|---|
| 單張尺寸 | ≤ 370×320 | ≤ 320×270 且一邊 ≥ 270 |
| 長寬 | 偶數、透明 RGBA | 偶數、透明 RGBA |
| 單檔 | ≤ 1MB | ≤ 1MB、影格 5–20、循環 1–4 |
| 張數 | 8/16/24/32/40 | 8/16/24 |
| main / tab | 240×240 / 96×74 | main 須 APNG、tab 靜態 |

整包壓成 `.zip`（≤60MB）；靜態與動態**不可混在同一包**。

## 架構

```
.claude/skills/
  char-gen/          # 產圖：用 codex image_gen 產角色一致的組圖/影格（agent 驅動）
  line-sticker-pack/ # 指揮：串起 char-gen 產圖 → sticker-tool 打包 → 驗證
src/
  core/        # 純邏輯、平台無關（mobile 可重用）：spec / types / validate / naming / grid / prompt / color
  config/      # zod schema + 載入正規化
  pipeline/    # Node 影像處理：cropGrid / removeBackground / fitCanvas / stroke / text / pngFit / apng / processStatic / processAnimated
  package/     # buildMainTab / buildZip
  cli/         # build / gen / anim / prompt / init（皆為確定性打包；不含 codex）
```

`core/prompt.ts` 是 mobile 唯一要重用的鄰接層（mobile 不直接生圖，只產 prompt）；`pipeline/` 為 Node-only 重活。AI 產圖已外移到 char-gen skill，CLI 本身不呼叫 codex。

## 注意與限制

- **角色一致性**：跨 codex 呼叫守不住臉（會變「同一套衣服不同人」），故角色包一律**單次呼叫、單張組圖**，由 char-gen skill 以「餵回同一張參照圖 + 看圖驗證」保證。8 張品質最佳、16 張會警告降質、≥24 張預設擋下（需 `forceOversizeSet`）。多張大圖僅用於非角色（物件/風景）。
- **產圖／打包分工**：產圖（難、靠判斷、會漂移）交 char-gen skill；CLI 只做切格 / 去背 / fit / 疊字 / 壓縮 / 打包的確定性流程。解耦的好處是打包失敗多半調個參數重跑即可，不必重畫、不浪費 codex 額度。
- **去背**：`@imgly` 首次執行需從 CDN 下載 onnx 模型（非真離線）；無法直接搬到 mobile，屬平台專屬重寫項。
- **中文字型**：疊字一律 base64 內嵌字型檔；給家族名會走 `fc-match` 解析，找不到字型會**報錯**而非靜默 fallback 成豆腐。建議直接給 `.otf/.ttf` 路徑。
- **動態 APNG**：用純 JS 的 `upng-js`（可攜），編碼後改寫 acTL `num_plays` 以符合 LINE 的 1–4 循環。
```
