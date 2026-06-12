---
name: line-sticker-pack
description: 做 LINE 貼圖上架包的總指揮。把「我要做一組貼圖」端到端跑成符合 LINE Creators Market 規格的上架包——先用 char-gen skill 產出角色一致的組圖／連續影格，再寫好 sticker-tool 設定檔、呼叫 sticker-tool CLI 做切格／去背／fit／疊字／打包，最後驗證、不合規就迭代。當使用者想把一張照片、一個角色或一個點子做成 LINE 貼圖（靜態或動態）、要產整組可上架的貼圖、或提到 LINE Creators Market／貼圖包／main.png／tab.png 時就用它，即使他沒明講「打包」或「上架」。產圖細節交給 char-gen、影像處理交給 sticker-tool CLI，本 skill 只負責把整條流水線串起來並顧好 LINE 規格。
allowed-tools: Bash, Read, Write, Skill
---

# line-sticker-pack：LINE 貼圖上架包總指揮

## 一個核心信念（先讀這個）

**這個 skill 是指揮，不是工人。** 它自己「不畫圖、不改像素」，而是把一件大事拆成兩個各自擅長的角色，並顧好它們中間的接縫與最後的 LINE 規格：

- **產圖（難、靠判斷、會漂移）→ 交給 [char-gen](../char-gen/SKILL.md) skill。** 角色一致性來自「餵回同一張參照圖」與看圖驗證，那是 char-gen 的本職；你不要自己寫長提示詞去描述角色。
- **影像處理＋打包（機械、確定性）→ 交給 sticker-tool CLI。** 切格／去背／縮放置中／描邊／疊字／壓到規格／組 APNG／打 zip，都是程式的確定性流程。

把這兩件事**解耦**有個很實際的好處：打包失敗（尺寸、位元組、張數）幾乎都能靠「重跑 CLI、調個參數」修好，**不必重畫**——別讓一個排版問題浪費一次 codex 產圖。反過來，角色畫歪了就回 char-gen 點名修正，不要靠 CLI 硬凹。

帶著這個信念，下面的流程就只是「把對的東西交給對的人」。

## 流水線（指揮的總譜）

```
需求 ──①定盤──> ②char-gen 產圖 ──> ③寫 config ──> ④CLI 打包 ──> ⑤驗證/迭代 ──> 上架包
        (張數/動靜/      (組圖 or          (對齊產出      (gen --sheet /      (不合規→調參重打包;
         角色來源)        連續影格)          與規格)        anim)              畫歪→回 char-gen)
```

### ① 定盤——先把這幾件事問清楚或合理預設

| 決策 | 選項與預設 | 為什麼重要 |
|---|---|---|
| 靜態 or 動態 | 靜態（預設）/ 動態 APNG | 兩者**不可混包**；規格、張數、CLI 指令都不同 |
| 張數 | 靜態 8/16/24/32/40；動態 8/16/24 | LINE 只收這些數；**角色包預設 8**（見下） |
| 角色來源 | 照片 / 已有參照圖 / 純風格（非角色） | 決定 char-gen 要不要先建 master |
| 風格 | 一句話描述（如 "flat cartoon, bold outline, pastel"） | char-gen 與 config 都要 |
| 每格內容 | N 個表情／動作（順序＝出圖順序＝疊字順序） | 順序一錯，文字就貼到錯的圖上 |
| 疊字／描邊 | 選填 | 描邊預設可開；中文字型要給 `.otf/.ttf` 路徑 |

**角色一致性的硬限制（很重要，來自 char-gen 與 sticker-tool 的共識）**：同一個角色的貼圖必須**單張組圖、單次產完**，跨次呼叫守不住臉。所以：
- **8 張**＝品質最佳，預設就推這個。
- **16 張**＝可以做，但格子變小、臉部細節會降質，要先告訴使用者這個取捨。
- **≥24 張角色包**＝預設擋下；真要做得開 `forceOversizeSet: true`（接受明顯降質），或拆成多個獨立角色／主題。
- 非角色（物件、貼紙感的圖示）才可以分多張大圖產。

### ② 產圖——呼叫 char-gen，把「要畫什麼」交出去

**用 Skill 工具呼叫 `char-gen`**（或請使用者 `/char-gen`），把以下交給它，其餘（signature features、master、看圖驗證、漂移修正）讓 char-gen 自己處理：

- **靜態貼圖組**：請 char-gen 產**一張 N 格組圖**（reading order：左→右、上→下），**透明背景**，存到你指定的絕對路徑（如 `<out>/_sheets/sheet_01.png`），每格 ≥320px。把你定盤的 N 個表情依序當 VARIATION。
- **動態貼圖**：每一張貼圖請 char-gen 產**一張 N 格 frames-sheet**（單一 PNG 多格網格，預設 8 格起步；char-gen 會用逐格分鏡寫死每格的姿勢＋表情），同場景同鏡頭、只有動作推進、可循環、**臉全程清楚**，之後交給 `anim --sheet --grid` 自動切格＋穩定化。動作設計（哪格做什麼）由 char-gen 列分鏡給使用者確認，你只交付「動作主題＋情緒」。

你（指揮）只負責把「風格＋每格要什麼＋版面＋輸出路徑」講清楚，**不要自己描述角色長相**——那是 char-gen 用參照圖在守的。產完後 char-gen 會回報並驗證；若某格畫歪，走 char-gen 的修正流程（點名那一處），不要整張重來。

> 想省 codex 額度時：先只產 8 格確認風格／角色對了，再決定要不要擴張；別一次梭哈大組圖。

### ③ 寫 config——把產出與規格對齊

用 `Write` 產一份 sticker-tool 設定檔（YAML），把定盤結果寫進去。最小骨架：

```yaml
package: { name: "My Pack", count: 8 }
source: ai
ai:
  style: "flat cartoon, bold black outline, soft pastel palette"
  isCharacter: true
  transparent: true
  grid: auto          # 或 "4x2"，須能容下 count
  crop: equal         # 切格已自動偵測背景＋去背（綠幕/近白/實底都行）；極少需要 equal+rembg 補刀
processing:
  stroke: { enabled: true, width: 8, color: "#ffffff" }
cover: 1
# 疊字 / 動態影格逐張覆寫（stickers[i] ↔ 第 i+1 格，順序要對上）：
stickers:
  - text: { content: "嗨", x: 50, y: 88, size: 40, color: "#000", font: "/abs/NotoSansTC-Bold.otf" }
```

動態包另外要 `animation:`（loops 1–4、durationSec、autoFit）並在每個 `stickers[i].frames: [...]` 填 char-gen 產出的影格路徑。**完整欄位、CLI 指令、LINE 規格表、疑難排解都在 [references/sticker-tool.md](references/sticker-tool.md)——寫 config 或打包前先讀它。**

### ④ 打包——呼叫 sticker-tool CLI（確定性流程）

CLI 在專案 `/Users/apple/Projects/fun-tools/sticker-tool`，用 `npm run sticker -- <子指令>` 跑（或 `npm run build` 後用 `sticker-tool`）。

- **靜態**（把現成組圖切格打包；`--sheet` 一張版面給一個，相對 CWD）：
  ```bash
  npm run sticker -- gen --config <cfg.yaml> --sheet <out>/_sheets/sheet_01.png --out <out> --name "My Pack"
  ```
- **動態·整包**（影格路徑已寫在 config 的 stickers[].frames）：
  ```bash
  npm run sticker -- anim --config <cfg.yaml> --out <out> --name "My Pack"
  ```
- **動態·單段**（char-gen 的一張 frames-sheet → 一段動畫；自動切格＋穩定化殺漂移）：
  ```bash
  npm run sticker -- anim --sheet <frames.png> --grid 4x4 --frames 16 --duration 2 --out <out> --name kiss
  ```

CLI 會切格／去背／fit／疊字／壓到 ≤1MB／組 APNG／打 zip，**最後印出逐項 LINE 規格驗證**。

> 切格不再死切 1/n：會**先以程式偵測背景→去背→把切線吸到真實透明縫→切完校正**，並印出「背景型態／切線成本／對齊縫 N/M／空格」的**算好的報告**。照數字判斷品質、不要看拼貼圖手調——細節與如何讀報告見 [references/sticker-tool.md](references/sticker-tool.md) 的「3.5 切格自動分析」。

### ⑤ 驗證與迭代——讀 CLI 的驗證輸出，對症下藥

CLI 結尾會說「符合 LINE 規格」或列出哪裡不符。**先分清楚是「打包問題」還是「畫面問題」**：

- **打包問題（調參重跑 CLI，不重畫）**：超尺寸→降 `maxSize` 或 `stroke.width`；動態超 1MB→確認 `autoFit: true`、或降 `animation.minColors/minFrames`、調 `priority`；張數不對→改 `count` 或補圖；殘留背景→切格已自動去背，仍殘留才設 `processing.removeBackground: true`；**動圖人物左右漂移→`animation.stabilize` 預設已殺**（填補自動比照背景，白底不必去背）。
- **切格報告示警（算出來的，不必看圖）**：「找不到乾淨透明縫」→ 主體被畫到越格線、沒留 gutter，回 char-gen 讓主體佔格 75–80%＋留間隙；「空格」→ 某格漏畫或切錯位；「背景非透明」→ 已語意去背救回，最乾淨仍是請 char-gen 直接產透明底。
- **畫面問題（回 char-gen）**：臉變成不同人、臉被遮、風格不一致→用 char-gen 的修正模板重產**那一格／那一張**，再重跑打包。

修好後重跑 ④。打包很便宜，可以多跑幾次直到「符合 LINE 規格」。

## 常見陷阱（理解了就不會犯）

- **CLI 已不自己產圖**——它只打包。一定要先 ②（char-gen 產圖）才能 ④（CLI 打包）；直接 `gen` 沒給 `--sheet` 會報錯。
- **順序對齊**：char-gen 畫的第 1 格 ↔ 切出的第 1 格 ↔ `stickers[0]` 的疊字。定盤時就把表情清單編號，三邊用同一份順序。
- **路徑解析**：`--sheet`、`--out`、`--config` 是 CLI 參數，相對**當前工作目錄**；config 裡宣告的 `font`、`frames` 相對**設定檔所在目錄**。寫絕對路徑最保險。
- **本機照片要做靜態貼圖、且不需要 AI 變化**：那是 `npm run sticker -- build <圖目錄>`，根本不必經過 char-gen。這個指揮 skill 主要服務「要 AI 產角色貼圖」的情境。
- **跑 CLI 前**：確認專案已 `npm install`；首次去背會下載 onnx 模型（需連網）。

## 何時不要用這個 skill

- 只是要「產一張／一組一致的角色圖」而不打包成 LINE 上架包→直接用 [char-gen](../char-gen/SKILL.md)。
- 已經有現成的個別貼圖檔、只想打包→直接用 sticker-tool 的 `build`（本機靜態）或 `gen --sheet`／`anim`，不必走完整指揮流程。
- 不是 LINE 規格（其他平台尺寸）→本 skill 的規格驗證是寫死 LINE 的，先確認需求。
