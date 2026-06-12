# LINE 貼圖製作工具 (sticker-tool) — 實作計畫

## Context

使用者想做一個 LINE 貼圖**製作**工具：把原圖（本機照片或 AI 生成）自動處理成符合 LINE Creators Market 規格、可直接上架的貼圖包。空專案（greenfield），Node v24.5.0、codex-cli 0.137.0 已就緒。

經多輪跳窗釐清的需求定案：

| 項目 | 決定 |
|---|---|
| 核心目的 | 製作貼圖（生成/去背 → 裁切置中 → 縮放 → 打包），非下載別人貼圖 |
| 平台 | **初期 CLI**，之後做成 mobile app |
| 語言/runtime | Node.js + TypeScript（之後 mobile 走 React Native 共用 `core/`） |
| 輸出 | 完整 LINE 上架包（main.png/tab.png/序號圖 + zip） |
| 輸入來源 | **AI 生成 與 本機圖片去背 並存** |
| AI 產圖機制 | **CLI：呼叫 codex CLI（`codex exec`）產圖，可傳參考圖（`-i`）**；**mobile：只產出 prompt**（不直接生圖） |
| 組圖 | 一張大圖含多格貼圖；**格數由目標張數決定**；**多張大圖須維持同樣外觀（風格一致）** |
| 裁切 | 從組圖切出個別貼圖；**三種策略都實作讓用戶選**：等分網格 / 等分後去背置中 / 偵測物件自動切 |
| 去背 | **AI 來源：請 codex 直接輸出透明 PNG（去背預設關，僅殘留時補刀）；本機來源：本地免費模型去背（預設開）** |
| 描邊 | 自動白色描邊（可開關） |
| 加文字 | 透過設定檔（YAML/JSON）指定內容/位置/字型/顏色 |
| 動態貼圖 | APNG，由連續影格組合（影格可來自本機或 codex） |

**設計主軸**：純邏輯（規格常數 / 驗證 / 命名 / grid 配置 / **prompt 組裝**）抽到 `core/`，平台無關 → mobile 直接重用（mobile 只用到「產 prompt」這層）；codex 驅動、sharp、去背模型等 Node-only 重活放 `pipeline/` 轉接層。

## ✅ M0 Spike 已驗證 — codex 產圖能力（2026-06-09 實測通過）

實測指令：`codex exec -i ref.jpg -s workspace-write -c sandbox_workspace_write.network_access=true -C <dir> --skip-git-repo-check "<產 12 連續影格 prompt>"`，結果全數通過：

- **機制**：codex 用**內建 `image_gen` 工具**產圖，**不需 OPENAI_API_KEY**（吃 codex 自身登入）。退回方案（只產 prompt 半自動）不需要了。
- **組圖**：codex 自行生成 4×3 sprite sheet（綠幕背景），符合「組圖」概念。
- **去背**：codex 自選「綠幕生成 → Pillow 切格 + 去綠幕 → RGBA」，12 格角落全透明。
- **規格**：輸出精準 320×270、RGBA；**風格/角色 12 格高度一致、動畫連貫**。
- **傳參考圖**：`-i ref.jpg` 有效，重繪同角色。
- 沙箱：`danger-full-access` 會被 Claude Code 安全分類器擋；用 `workspace-write` + `sandbox_workspace_write.network_access=true` 可過。

**重要啟示**：codex 不只產圖，連「組圖→切格→去綠幕」都能自己包辦 → 工具可把這段「委派」給 codex，自己專注於 spec-fit / 驗證 / main-tab / 打包 / APNG 組裝；但仍保留自有 `cropGrid` 三策略作為對 codex 原始 sheet 的可控/備援切法。

**APNG 大小（已實測；⚠️真實上限是 1MB，非先前誤記的 300KB）**：12 格全彩 APNG = 1467KB（略超 1MB）。**在 1MB 下壓力大減**：12格128色=518KB、12格q90=639KB 都輕鬆過關 → 可保 12 格、只需輕度 pngquant，毋須砍格/重壓。下列 300KB 相關數據與激進壓縮策略多為前述錯誤前提的產物，已不需要：
- 純失真減色觸底：FASTOCTREE 32色仍 537KB；ffmpeg(pred mixed)=1485KB。
- **APNG 影格差分在此幾乎無效**：實測幀間平均變動面積 71.5%——因 codex 每格「獨立重畫」，連不動的區域都有像素差異，無穩定背景可差分。此為 AI 逐幀生成的本質限制。
- **真實 pngquant+apngasm 實測**：pngquant q90（高品質）8格仍=427KB（apngasm 重編碼展開調色盤）；**鎖色數才有效 → 64色×8格=274KB ✅近無損、32色×8格=164KB**；64色×12格=410KB 仍超標。
- → 修正後 M5：**預設保留全部影格 + auto-fit 至 ≤1MB**（多數情況 128 色內就達標）；減格/策略B（固定背景）皆非必要，砍除。

## LINE 規格（已向官方文件確認，寫死為常數）

- 靜態貼圖：最大 **370×320** px、透明 **RGBA** PNG、長寬須為**偶數**、≥72dpi、建議四周留 10px 邊、單張 ≤1MB；張數 **8/16/24/32/40**
- 動態貼圖：APNG，最大 **320×270** px 且**寬或高至少一邊須 ≥270**（高為長邊時須剛好 270）、長寬偶數、影格 **5–20**、播放 ≤4 秒（1–4 loops）、**單檔 ≤1MB（⚠️不是 300KB）**；張數**僅 8/16/24**
- `main.png` = **240×240**（**動態包必須是 APNG**，首格當靜態縮圖）；`tab.png` = **96×74** 靜態 PNG（系統自動加播放符號，勿自畫）
- 序號命名 `01.png`…（兩位數）；**靜態與動態不可混在同一包**；整包壓成 `.zip`（≤60MB）

來源（已查證 2026-06-09）：creator.line.me/en/guideline/sticker（靜態）、creator.line.me/en/guideline/animationsticker（動態）。

## 技術選型

- **sharp** — 縮放/裁切/padding/合成/PNG I/O/SVG 文字 rasterize
- **@imgly/background-removal-node** — 本地免費去背
- **upng-js** — 多張 PNG 影格 → APNG
- **codex CLI**（subprocess）— CLI 端 AI 產圖；傳參考圖維持一致性
- **commander** — CLI；**yaml + zod** — 設定檔；**archiver** — zip
- TypeScript + tsx/tsup

## 專案結構

```
sticker-tool/
  package.json, tsconfig.json, .gitignore, README.md
  plan/                   # 本計畫
  src/
    core/                 # 純邏輯，平台無關（mobile 重用）
      spec.ts             # LINE 常數：尺寸/張數/命名/邊距/檔案上限
      types.ts            # PackConfig / StickerItem / GridLayout 型別
      validate.ts         # 驗張數、偶數長寬、尺寸/檔案上限、main/tab
      naming.ts           # index → "01.png"
      grid.ts             # 由張數 → 決定 rows×cols、需幾張大圖（多張一致）
      prompt.ts           # 組裝產圖/組圖/影格 prompt（含風格區塊+一致性指示+透明背景+排版規則）；★mobile 只用這層
    config/
      schema.ts           # zod schema
      load.ts             # 讀 YAML/JSON + 驗證 + 預設
    pipeline/             # Node 影像處理轉接層
      codexGen.ts         # 呼叫 codex exec（內建 image_gen，+ -i 參考圖）產組圖/影格；首張當參考餵後續張以維持一致；可委派切格/去綠幕給 codex
      cropGrid.ts         # 三策略：'equal' | 'equal+rembg' | 'detect'
      removeBackground.ts # @imgly 去背
      fitCanvas.ts        # 等比縮放+置中+padding 到 bounds，確保偶數長寬
      stroke.ts           # alpha 擴張 → 白色描邊合成
      text.ts             # 依設定 SVG 疊字
      apng.ts             # 連續影格 → APNG
      processStatic.ts    # 靜態流程串接
      processAnimated.ts  # 動態流程串接
    package/
      buildMainTab.ts     # 產 main.png / tab.png
      buildZip.ts         # 組 main/tab/序號圖 + zip
    cli/
      index.ts            # commander：build / gen / prompt / init
  examples/sticker.config.yaml
  fixtures/               # 測試樣本圖
```

## 設定檔格式（`sticker.config.yaml`）

```yaml
package:
  name: "My Stickers"
  count: 24                 # 8/16/24/32/40 → 自動推 grid 與大圖張數
source: ai                  # ai | local
ai:
  style: "flat cartoon, bold black outline, pastel palette"
  transparent: true         # ★請 codex 直接輸出透明背景 PNG（AI 來源預設 true）
  isCharacter: true         # ★角色包→強制單次呼叫產完（保證同一人）；非角色可多次/多張
  grid: auto                # auto（由張數決定）| "4x3"
  reference: ref.png        # 選填：種子/角色參考，維持一致
  crop: equal               # equal | equal+rembg | detect
  forceOversizeSet: false   # 角色包 >16 張時須明確開啟才允許（接受單格降質）
processing:
  removeBackground: auto    # local→true；ai→預設 false，偵測殘留背景時自動補刀
  stroke: { enabled: true, width: 8, color: "#ffffff" }
  maxSize: [370, 320]
cover: 1                     # 用第幾張產 main/tab
animation:                   # 動態貼圖設定
  maxBytes: 1000000          # LINE 動態單檔 ≤1MB
  loops: 1                   # ★循環次數 1–4（LINE 不接受無限循環/0）；acTL num_plays
  durationSec: 2             # 總播放長度 ≤4 秒（loops × 單輪時長 ≤4s）
  autoFit: true              # ★同一組影格反覆重試，逐步減色/減影格直到達標
  priority: balanced         # ★降級順序：colors=保影格先降色｜frames=保色先減格｜balanced=交錯，先保「色≥48 且 格≥8」
  minColors: 16              # 量化下限（品質地板，到此仍超標就警告）
  minFrames: 5               # 影格下限（LINE 動態最少 5 格）
  ladder: auto               # auto=內建品質階梯；或自訂 [{colors,frames}...]
stickers:                    # local 來源或逐張覆寫時使用
  - input: cat01.png
    text: { content: "嗨", x: 50, y: 88, size: 40, color: "#000", font: "Noto Sans TC" }
  - frames: [wave1.png, wave2.png, wave3.png]   # 有 frames → 動態 APNG
    fps: 10
```

## 實作里程碑（依序交付，每段可獨立驗收）

> 進度追蹤見獨立檔 `plan/checklist.md`（寫進度只更新該檔，不必重讀本計畫）。

**M0 — Spike：驗證 codex 產圖能力 ✅ 已完成（見上節）**
- 結論：codex 內建 `image_gen` 可產組圖+切格+去背，AI 路徑確定可行。spike 產物保留於 `spike/` 可當 fixtures。

**M1 — 骨架 + core + 本機靜態主流程（不依賴 codex，先可交付）**
- npm/tsconfig/依賴；`core/` 全部（spec/types/validate/naming/grid/prompt）
- `pipeline/removeBackground`、`fitCanvas`、`processStatic`
- `package/buildMainTab`、`buildZip`；`cli build <inputDir> --out --count`
- 驗收：本機樣本圖 → 用 sharp metadata 確認尺寸/偶數/檔案符合規格、zip 結構齊全

**M2 — AI 產圖 + 組圖 + 三種裁切**
- ★**角色一致性策略（已實測定案，見 issues.md #4）**：跨呼叫 codex **守不住臉**（「不同人穿同套衣服」），故 **`isCharacter` 角色包一律單次呼叫、單張組圖產完**。張數上限：8 完全支援、16 警告降質、**24 預設擋下**（需 `forceOversizeSet`）。多次呼叫/多張大圖僅限非角色貼圖。
- `core/grid`：依張數+isCharacter 決定 rows×cols 與是否允許多張；超限檢查與警告。
- `pipeline/codexGen`：依 `core/prompt` 組 prompt → `codex exec`；prompt 鎖死特徵；提供重生迴圈
- `pipeline/cropGrid`：等分 `equal`（主線；codex 已切好時僅驗證）；`equal+rembg` 為 equal 串 removeBackground；~~detect 砍除~~（見 issues S-1）
- `cli gen --config ...`；`cli prompt`（只輸出 prompt，供 mobile/半自動）
- 驗收：單次產出整套同一角色 → 切出正確張數；>16 張角色包正確警告/擋下

**M3 — 白色描邊（可開關）**
- `pipeline/stroke`：alpha 擴張→填白→疊底；由設定控制，接進 processStatic

**M4 — 設定檔 + 加文字**
- `config/schema`+`load`（YAML/JSON+zod+預設）；`pipeline/text`（SVG 疊字，注意中文字型嵌入）
- `cli init` 產範例設定檔

**M5 — 動態貼圖 APNG**
- `pipeline/apng`：連續影格逐幀 fit（≤320×270 且一邊=270、偶數）、設 `loops`(1–4) → apngasm 編 APNG
- ★**auto-fit 壓縮（`animation.autoFit`，僅保證 ≤1MB）**：組裝→量大小，超標才**降色數**（256→128→96→…，至 `minColors`）。在 1MB 上限下多數情況 128 色內即達標、保留全部影格；**減影格僅在極端情況觸發**（罕見）。第一個達標即停、回報最終「色數×影格×KB」；到地板仍超標才警告。
- ~~策略 B（固定背景+只重畫臉）~~：已砍——1MB 下保 12 格輕鬆達標，不需要為差分改生成方式。
- `processAnimated`：影格可來自本機或 codex（codex 產角色一致的連續影格）；套用 `loops`/`durationSec`
- ★每格須透明且物件邊界一致，否則 APNG 疊起來有殘影/抖動；不一致時對每格補去背 + 對齊
- 驗收：APNG 可播放、無殘影抖動、≤320×270 且一邊≥270、≤1MB、張數 8/16/24、main.png 為 APNG

## 重用 / 注意

- 全新專案，無既有程式可重用；參考鄰居 `../media-dler`（Kotlin）的 README/plan/.github 慣例維持風格一致。
- mobile（React Native）時：`src/core/`（含 `prompt.ts`）整層搬移，mobile 只用「產 prompt」；`pipeline/` 換成原生實作。

## 端到端驗證

1. `fixtures/` 放 3–5 張帶背景測試圖（本機路徑用）。
2. 本機：`npx tsx src/cli/index.ts build fixtures --out out --count 8`。
3. AI：`npx tsx src/cli/index.ts gen --config examples/sticker.config.yaml --out out`（需 M0 通過）。
4. sharp metadata 逐項檢查：main=240×240、tab=96×74、序號圖 ≤370×320 偶數 ≤1MB；APNG ≤320×270 且一邊≥270、≤1MB。
5. `unzip -l out/<name>.zip` 確認包結構與命名。
6. 肉眼確認去背乾淨、多張大圖風格一致、裁切無歪斜、描邊/文字位置、APNG 動畫順暢。
7. （可選）實際匯入 LINE Creators Market 試上傳。
