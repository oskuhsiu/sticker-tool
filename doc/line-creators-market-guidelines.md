# LINE Creators Market 製作與審核規格總整理

> 查證日期：2026-07-30（Asia/Taipei）
> 主要來源：LINE Creators Market 英文版官方製作準則、細節頁、審核準則與 Creators Help Center。
> 適用範圍：一般／動態／自訂／訊息／大貼圖／全螢幕彈出／特效貼圖、一般／動態 emoji、主題。
> 注意：這是便於本專案實作與交付檢查的中文整理，不取代提交當下的 My Page 檢查結果，也不是法律意見。

## 目錄

- [先看這裡：最容易踩錯的規則](#先看這裡最容易踩錯的規則)
- [資料可信度與用語](#資料可信度與用語)
- [共同的商品文字限制](#共同的商品文字限制)
- [貼圖總表](#貼圖總表)
- [一般靜態貼圖](#一般靜態貼圖)
- [動態貼圖](#動態貼圖)
- [自訂貼圖](#自訂貼圖)
- [訊息貼圖](#訊息貼圖)
- [大貼圖](#大貼圖)
- [全螢幕彈出貼圖](#全螢幕彈出貼圖)
- [特效貼圖](#特效貼圖)
- [Emoji](#emoji)
- [動態 Emoji](#動態-emoji)
- [Emoji 套組與檔名](#emoji-套組與檔名)
- [主題](#主題)
- [審核與內容限制](#審核與內容限制)
- [提交、照片、標籤與上架後限制](#提交照片標籤與上架後限制)
- [與 sticker-tool 的關係](#與-sticker-tool-的關係)
- [官方來源索引](#官方來源索引)

## 先看這裡：最容易踩錯的規則

1. **APNG 的副檔名仍是 `.png`。** 不要交 `.apng` 副檔名。
2. **動態貼圖與動態 emoji 的單輪播放時間只能是 1、2、3 或 4 秒。**
   例如 1.5 秒即使總長未超過 4 秒也不合法。
3. **全螢幕彈出／特效貼圖只能選 1、2 或 3 秒。**
4. **總播放時間是「單輪秒數 × loop 數」。**
   動態貼圖／emoji 不得超過 4 秒；全螢幕彈出／特效貼圖不得超過 3 秒。
5. **動畫需有 5–20 個實際 APNG frame。**
   某些工具會合併完全相同的連續 frame；不能只看輸入 PNG 數量。
6. **所有 frame 使用完全相同的影像會造成上傳錯誤。**
7. **動態貼圖的第一格必須能單獨傳達情緒或意圖。**
   第一格會在動畫停止、不支援動畫的裝置、商店預覽等情境中顯示。
8. **一般動態貼圖不是任意小於 320 × 270 就行。**
   寬或高至少一邊需達 270 px；若高是長邊，高必須正好 270 px。
9. **全螢幕彈出／特效 APNG 必須有一邊正好 480 px。**
   寬為 480 時，高至少 320；高為 480 時，寬至少 200。
10. **emoji 是正好 180 × 180 px，不是「最大 180 × 180」。**
11. **一般 emoji 單圖上限 1 MB；動態 emoji 單圖只有 300 KB。**
12. **文字欄位的亞洲語言字元與部分符號可能按 2 個字元計算。**
13. **技術規格通過不等於審核會通過。**
    LINE 仍會審視可讀性、日常可用性、內容、廣告、權利與地區因素。
14. **主題規格正在經歷 iOS 26 過渡。**
    官方 overview 的「60 張／34 個 menu button」與 detail 頁列出的兩代 36 個 menu button
    互相矛盾，提交前必須再以當下 My Page、最新版 PSD 範本及 detail 頁為準。

## 資料可信度與用語

本文使用以下標記方式：

- **官方明文**：LINE 頁面直接列出的數值、格式或限制。
- **官方建議**：可提高可讀性或降低檔案大小，但不是同等強度的硬性格式條件。
- **本文件解讀**：由多個官方頁面組合而成，會明確標出。
- **未明定**：官方頁面沒有把單位或行為定義到可安全推定的程度。

尺寸一律為 `寬 × 高`，單位為像素。本文保留官方用詞的差異：

- `exactly`／只列固定尺寸：視為固定尺寸。
- `up to`／`max`：視為上限。
- `min`：視為下限。
- `1 MB`、`300 KB`、`20 MB`、`60 MB`：官方沒有在這些頁面定義是十進位或二進位位元組。
  自動化工具應採較保守的十進位上限，並保留安全餘量。

## 共同的商品文字限制

[貼圖](https://creator.line.me/en/guideline/sticker/)、
[emoji](https://creator.line.me/en/guideline/emoji/) 與
[主題](https://creator.line.me/en/guideline/theme/) 的商品文字欄位上限相同：

| 欄位 | 上限 |
| --- | ---: |
| 創作者名稱 | 50 字元 |
| 商品標題 | 40 字元 |
| 商品說明 | 160 字元 |
| Copyright | 50 字元 |

共同注意事項：

- 亞洲語言字元與部分符號可能按 2 個字元計算。
- 審核準則另外禁止或不建議：錯字、格式錯誤、過短文字、URL、裝置間可能顯示不同的
  emoji／特殊字元、文案與圖像不符，以及商品廣告或導購文字。
- 大貼圖的商品說明末尾會由 LINE 依使用者語言自動補上「此貼圖會在聊天中以加大尺寸顯示」
  的提示；創作者不用自己加入。
- Creators Help Center 表示商品資訊可登錄 12 種語言，建議預先備妥要販售地區的翻譯。

## 貼圖總表

以下是最常查的技術條件。詳細例外與設計規則請看各類型章節。

| 類型 | 套組數量 | 貼圖／動畫尺寸 | 貼圖格式 | main | tab | 單圖上限 | ZIP 上限 |
| --- | --- | --- | --- | --- | --- | ---: | ---: |
| 一般靜態 | 8／16／24／32／40 | 最大 370 × 320 | PNG | 240 × 240 PNG | 96 × 74 PNG | 1 MB | 60 MB 以下或等於 |
| 動態 | 8／16／24 | 最大 320 × 270；至少一邊達 270 | APNG，副檔名 `.png` | 240 × 240 APNG | 96 × 74 PNG | 1 MB | 60 MB 以下或等於 |
| 自訂 | 8／16／24／32／40 | 最大 370 × 320 | PNG + My Page caption style | 240 × 240 PNG | 96 × 74 PNG | 1 MB | 60 MB 以下或等於 |
| 訊息 | 8／16／24 | 最大 370 × 320 | PNG + My Page message style | 240 × 240 PNG | 96 × 74 PNG | 1 MB | 60 MB 以下或等於 |
| 大貼圖 | 8／16／24／32／40 | 最小 80 × 524；最大 396 × 660 | PNG | 240 × 240 PNG | 96 × 74 PNG | 1 MB | 60 MB 以下或等於 |
| 全螢幕彈出 | 8／16／24 | 靜態最大 370 × 320；彈出 APNG 最大 480 × 480 | 每項同時有靜態 PNG 與 APNG | 240 × 240 PNG + 480 × 480 APNG main | 96 × 74 PNG | 1 MB | 60 MB 以下或等於 |
| 特效 | 8／16／24 | 靜態最大 370 × 320；特效 APNG 最大 480 × 480 | 每項同時有靜態 PNG 與 APNG | 240 × 240 PNG + 480 × 480 APNG main | 96 × 74 PNG | 1 MB | 60 MB 以下或等於 |

補充：

- 貼圖數量可在送審前從 Manage Stickers 修改；送出審核後不可再改套組數量。
- 上表中的單圖上限也適用 main、tab 與額外動畫圖；官方以「每一張 image」表述。
- 所有貼圖頁面都要求透明背景。這代表實際背景需透明，不只是檔案含 alpha channel。
- 一般／自訂／訊息／大貼圖明文要求 RGB、至少 72 dpi；一般靜態、自訂、訊息與大貼圖頁面
  也要求貼圖寬高為偶數。全螢幕彈出／特效頁沒有重複所有這些句子，勿自行把未重複的條件
  當成已由該頁明文確認。

## 一般靜態貼圖

來源：[Stickers creation guidelines](https://creator.line.me/en/guideline/sticker/)

### 硬性技術條件

| 資產 | 數量 | 尺寸 | 格式 |
| --- | ---: | --- | --- |
| Main image | 1 | 240 × 240 | PNG |
| Sticker images | 8、16、24、32 或 40 | 最大 370 × 320 | PNG |
| Chat thumbnail icon | 1 | 96 × 74 | PNG |

- 貼圖影像會由 LINE 自動縮放；寬與高都應是偶數。
- 使用 RGB 色彩模式，解析度至少 72 dpi。
- 每個 image 檔案不得超過 1 MB。
- 整批 ZIP 不得超過 60 MB。
- 背景必須透明。
- 建議把透明裁切邊界與內容保持約 10 px 的距離，並以整套視覺平衡為準。
  這是約略設計建議，不是要求固定做成四邊各 10 px。

### 設計方向

官方偏好：

- 日常對話中容易使用。
- 情緒、文字訊息或插圖能快速理解。

官方不建議：

- 難以放進對話情境的物件或風景。
- 太細長、全身高個角色等在聊天中辨識度不佳的構圖。
- 整套變化過少，例如全是很淡的顏色或純數字串。
- 涉及公共秩序、兒少飲酒／吸菸、性、暴力或煽動民族主義的內容。

## 動態貼圖

來源：

- [Animated stickers overview](https://creator.line.me/en/guideline/animationsticker/)
- [Animated sticker detail](https://creator.line.me/en/guideline/animationsticker/detail/)

### 資產與尺寸

| 資產 | 數量 | 尺寸 | 格式 |
| --- | ---: | --- | --- |
| Main image | 1 | 240 × 240 | APNG，以 `.png` 命名 |
| Animated sticker images | 8、16 或 24 | 最大 320 × 270 | APNG，以 `.png` 命名 |
| Chat thumbnail icon | 1 | 96 × 74 | 靜態 PNG |

每個動態貼圖還需同時符合：

- 寬、高不得超過 320 × 270。
- 寬或高至少有一邊達 270 px。
- 若高是長邊，高必須正好為 270 px。
- 5–20 個 APNG frame。
- 單輪只可為 1、2、3 或 4 秒。
- 1–4 loops。
- `單輪秒數 × loops ≤ 4 秒`。
- RGB 色彩空間。
- 每個 image 最大 1 MB；ZIP 最大 60 MB。
- 背景透明。
- Chat thumbnail 右上角的播放符號由 LINE 自動加上，不能自己畫。

### Frame、第一格與留白

- 官方 detail 頁要求第一格在靜態顯示時也能表達主要情緒或意圖。
- 如果真正的動作故事從第二格開始，而最後一格才顯示關鍵表情，可以把關鍵表情另放到第一格，
  再從第二格開始播放敘事。
- 第一格會出現在：動畫未播放的聊天畫面、不支援動畫的 LINE／裝置、Sticker Shop 與 LINE STORE 預覽。
- 官方要求 frame 畫布保持在最大尺寸內，並明確建議去除不需要、沒有動的外圍留白。
- **本文件的 pipeline 實作解讀：**去除外圍留白時仍需讓整段 sequence 共用一致的 canvas／座標系；
  若逐格貼著主體各自裁切，會製造非原始動作的縮放或跳動。
- APNG 工具可能把重複的相同圖合併，成品必須重新解碼確認仍有 5–20 frames。
- 所有 frame 都相同的 APNG 不會被視為有效動畫，會導致上傳錯誤。

### 控制檔案大小

較容易超過 1 MB：

- 大量漸層而非平塗。
- 大面積背景持續變動。
- 大範圍細緻火焰、速度線、閃光等特效。

較容易壓在上限內：

- 平塗與受限色盤。
- 合理重用 frame。
- 必要時先壓縮來源 PNG，再產生 APNG；仍應以最終 APNG 的解碼結果和檔案大小為準。

### 合法與非法時間例

| 單輪 | Frames | Loops | 總播放 | 結果 |
| ---: | ---: | ---: | ---: | --- |
| 1 秒 | 20 | 4 | 4 秒 | 合法 |
| 4 秒 | 20 | 1 | 4 秒 | 合法 |
| 1 秒 | 50 | 1 | 1 秒 | 不合法：frames 超過 20 |
| 3 秒 | 20 | 2 | 6 秒 | 不合法：總播放超過 4 秒 |
| 1.5 秒 | 5–20 | 1 | 1.5 秒 | 不合法：單輪不是整數允許值 |

## 自訂貼圖

來源：

- [Custom stickers overview](https://creator.line.me/en/guideline/customsticker/)
- [How to make custom stickers](https://creator.line.me/en/guideline/customsticker/detail/)
- [Official font list](https://creator.line.me/en/guideline/customsticker/font/)

自訂貼圖讓購買者在一個預留 caption 區輸入名字或其他短文字，購買後可以反覆修改。
商店以 `Ⓣ` 圖示識別。

### 基礎圖規格

基礎 PNG 規格與一般靜態貼圖相同：

- 8、16、24、32 或 40 張。
- 每張最大 370 × 320。
- Main 240 × 240；chat thumbnail 96 × 74。
- 貼圖寬高為偶數、RGB、至少 72 dpi、背景透明。
- 每張最大 1 MB；ZIP 最大 60 MB。
- 圖像周圍建議約 10 px margin。
- 官方建議用最新版 Chrome 或 Firefox 編輯。

### Caption style 可設定內容

- 最大字元數與商店預覽 sample text。
- 字型、字級、文字 outline 粗細。
- 水平或垂直方向。
- 靠左、靠右、置中或 justified；部分語言不支援所有 alignment。
- 起點、中心點、終點可調整角度與曲線。
- 每張貼圖只能有一個 caption。
- 垂直 caption 只支援日文與繁體中文，輸入字元會轉成全形顯示。
- `Apply Style to All Stickers` 會覆寫其他貼圖既有的 placement 與 curvature。

### 字數、留白與預覽

- 官方建議最大字數設為 4–6 字；更長會迫使字體縮小。
- 必須在全形與半形兩種情況下，以最大允許字數預覽。
- 編輯器標出的風險 margin 為左右各 25 px、上下各 15 px。
  caption 的起點、中心或終點落入此區，文字可能被裁切並可能遭拒。
- 建議文字盡可能大，並加 outline 以兼容深色聊天背景。
- 深色文字配白色或灰色 outline 是官方特別建議的組合。
- 垂直日文、繁中或泰文在 editor 的顯示可能與 preview 不同；以完整 preview 為準。
- 官方測試字串：
  - 日文：測寬漢字、濁音、小假名與長音，例如連續的 `園`、`が`、`ゃ`、`プ`、`ー`。
  - 英文：以連續大寫 `W` 測最寬情況。
  - 繁中：以連續的 `園` 測寬字。
  - 泰文：測含上、下附標的寬／高組合；泰文字元計數可能與肉眼看到的字數不同。
- 泰文 preview 官方特別建議使用最新版 Firefox。

### Style file

- 檔名格式為 `custom-{sticker_id}.style`，不要改名。
- 可從另一套貼圖匯入相同 placement、font 等設定。
- 匯出前先 Save；商品狀態至少進入 Waiting for Review 後，可從 Sticker Images 的 caption preview 再匯出。

### 可用字型

字型實際可選範圍會受販售地區影響。官方頁在查證日列出四組字型；若編輯器與本文不同，
以當下 My Page 為準。

<details>
<summary>日文字型（40）</summary>

`AR 琉璃丸ゴシック体_M`、`AR 勘亭流_H`、`AR マーカー体_E`、`AR マッチ体_B`、
`ARＰＯＰ５_H`、`AR 隷書体_M`、`AR 浪漫明朝体_U`、`AR 新藝体_E`、
`はるひ学園 L`、`はせトッポ M`、`闘龍`、`本明朝-U`、`TB古印体`、`ぽっくる`、
`TBゴシックR Std`、`TB赤のアリスDE`、`TB見出明朝 U`、`UDタイポス515`、
`はせミン B`、`タカハンド M`、`LIM暁`、`LIMインゴット`、`LIMかまぼこ`、
`LIMマドンナ`、`LIMマシュマロ`、`LIMオペラ`、`LIMぽっちゃん`、`LIMすえきち`、
`LIMスカ`、`LIMたんぽぽ`、`TBオズ`、`はせミン Std M`、`丸フォーク Pro M`、
`リュウミン Pro H-KL`、`リュウミン Pro R-KL`、`新ゴ Pro B`、`新ゴ Pro L`、
`新丸ゴ Pro B`、`新丸ゴ Pro L`、`竹 Std M`。

</details>

<details>
<summary>西文字型（40）</summary>

`Amira Semibold`、`AR ACTION`、`AR ALICE`、`AR BLANCA`、`AR BONNIE`、
`AR Brush1 Bold Italic`、`AR Brush2 Ultra`、`AR Brush3 Demibold`、
`AR Brush4 Heavy`、`AR Brush5 Bold`、`AR CENA`、`AR CHRISTY`、
`AR Dori Sans Bold`、`AR Dori Sans Heavy`、`AR ELLIS`、`AR ESSENCE`、
`AR RGothic1 Extrabold`、`AR RGothic1 Ultra`、`AR Roman1 Heavy`、
`AR Roman2 Ultra`、`AR Script5 Bold`、`AR Silver Casual`、`AR Silver Serif P`、
`ClarimoUD PE Bold`、`Dispatch Bold`、`Eggwhite Regular`、`Gasket Semibold`、
`HeronSerif Medium`、`MO ClearTone SG Ultra`、`MO Rocio`、`OccupantGothic`、
`PrensaDisplay SemiBold`、`Quiosco Semibold`、`Relay Medium`、
`Role Soft Text Pro EB`、`SalvoSerif Medium`、`Scout Regular`、`Stainless Bold`、
`Vonk Pro`、`Zonama Bold`。

</details>

<details>
<summary>繁體中文字型（40）</summary>

`文鼎板刻ＰＯＰ體_E`、`文鼎 DC 陳森田 MORITAF_B`、`文鼎 DC 黃陽尖魏體_B`、
`文鼎 DC 清圓體_B`、`文鼎 DC 香蕉人體 F_B`、`文鼎 DC 云康行楷_B`、
`文鼎 DC 云康鋼筆行楷_B`、`文鼎仿宋_B`、`文鼎方新書 H7_B`、
`文鼎方新書 H7_H`、`文鼎鋼筆行楷_B`、`文鼎廣告體_M`、`文鼎古印體_B`、
`文鼎隸書_D`、`文鼎毛楷_B`、`文鼎明體_B`、`文鼎明體_H`、`文鼎簽字筆體_E`、
`文鼎俏黑體_E`、`文鼎書林明體_E`、`文鼎標準楷體_B`、`文鼎標準宋體_E`、
`文鼎甜妞體_B`、`文鼎 TX 暖心體_D`、`文鼎 TX 暖心體_L`、
`文鼎 UD 晶熙黑體_H`、`文鼎UD晶熙黑體E1HK_E`、`文鼎 UD 書苑黑體_B`、
`文鼎 UD 書苑黑體_M`、`文鼎魏碑_B`、`文鼎行楷_B`、`文鼎行楷_L`、
`文鼎行書_M`、`文鼎顏楷_H`、`文鼎圓體_B`、`文鼎圓體_H`、
`森澤UD新黑 標準繁體 B`、`森澤UD新黑 標準繁體 DB`、
`森澤UD新黑 標準繁體 M`、`森澤UD新黑 標準繁體 R`。

</details>

<details>
<summary>泰文字型（40）</summary>

`Anupark-Bold`、`Anupark-Regular`、`Aree-Medium`、`DindanMai-Bold`、
`DindanMai Medium`、`EQTHRounded-Bold`、`EQTHRounded-Regular`、
`Jickho-Regular`、`Mah-Bold`、`ManopMai-Regular`、`MPCDPracharath-Bold`、
`MPDBKomol-DemiBold`、`MPDBKomol-Regula`、`Nakorn Regular`、`Naresuan-Regular`、
`OMPCDEQTH-Bold`、`OMPCDEQTH-Medium`、`OMPCDEQTH-Regular`、
`OMPDBManopticaNCon-M`、`OMPDBManopticaNCon-R`、`OMPDBManopticaN-M`、
`OMPDBManothai-DemiBold`、`OMPDBManothai-Medium`、`OMPKTSarabunMai-Bold`、
`OMPKTSarabunMai-Regular`、`QRType Regular`、`Sawaddee-Bold`、
`Sawaddee-Regular`、`Sonthana Regular`、`Sukhumvit-Bold`、
`SukhumvitTadmai-Bold`、`Teeprang Regular`、`Termtem-Bold`、`Thonglor-Heavy`、
`Thonglor-Regular`、`Thongterm-Bold`、`Thongterm-Regular`、`Thutiya-Regular`、
`Wittayakarn-Black`、`Wittayakarn-Regular`。

</details>

官方另列為已停用：`ClarimoUDThai-L`、`ClarimoUDThai-M`、
`ClarimoUDThaiModern-M`、`ClarimoUDThaiModern-R`、`ClarimoUDThai-R`。

## 訊息貼圖

來源：

- [Message stickers overview](https://creator.line.me/en/guideline/messagesticker/)
- [Creating message stickers](https://creator.line.me/en/guideline/messagesticker/detail/)
- [Official sample text](https://creator.line.me/en/guideline/messagesticker/sampletext/)
- [Official font list](https://creator.line.me/en/guideline/customsticker/font/)

訊息貼圖讓購買者輸入較長、可換行的自由訊息，商店以角落的筆圖示識別。

### 基礎圖規格

- 8、16 或 24 張。
- 每張最大 370 × 320，PNG。
- Main 240 × 240；chat thumbnail 96 × 74。
- 寬高偶數、RGB、至少 72 dpi、透明背景。
- 每張最大 1 MB；ZIP 最大 60 MB。
- 上傳基礎圖不需自行加入外圍 margin；LINE 會自動加上適當 margin。
- 官方建議以最新版 Chrome 或 Firefox 編輯。

### Message style

- 可設定字型、最大字級、行距、字距、outline 粗細、方向、alignment、文字框位置／尺寸／旋轉。
- 輸入範圍為 1–100 字元。
- 空白與換行各算 1 字元；Enter 可加入換行。
- 字數變多時，LINE 會自動縮小字級並換行。
- 文字框不得超出可見範圍，否則不能儲存。
- 每張只能有一個 message caption。
- 垂直方向只支援日文與繁中，並以全形字元顯示。
- Editor 與實際位置可能因影像尺寸而不同，儲存前必須看 Preview。
- Preview 會自動儲存 style 變更。
- 刪除基礎圖後重新匯入會重設該圖的 style。
- 官方建議使用 outline；深色字搭配白／灰 outline 能改善深色 theme 上的辨識度。
- 商品頁的 sample text 受審核文字限制；購買後由使用者輸入的訊息不受同一組商品文案限制。

### Style file 與 tag

- 檔名為 `message-{sticker_id}.style`，不要改名。
- 只能匯入與新套組語言相同的 style file。
- 狀態至少 Waiting for Review 後，可從 Preview Message Styles 匯出。
- 訊息貼圖不提供一般 tag 設定。使用者第一次輸入並送出某段文字後，該文字會保存在其建議中，
  之後可用同一文字喚出貼圖。
- 官方 sample text 頁提供日文、英文、繁中、泰文、印尼文各 15 個短句與 15 個長對話範例；
  它們是商店展示文字參考，不是必須逐字使用的規格。

## 大貼圖

來源：[Big stickers creation guidelines](https://creator.line.me/en/guideline/bigsticker/)

### 技術條件

| 資產 | 數量 | 尺寸 | 格式 |
| --- | ---: | --- | --- |
| Main image | 1 | 240 × 240 | PNG |
| Big sticker images | 8、16、24、32 或 40 | 最小 80 × 524；最大 396 × 660 | PNG |
| Chat thumbnail icon | 1 | 96 × 74 | PNG |

- 貼圖寬與高需為偶數。
- RGB、至少 72 dpi、透明背景。
- 每張最大 1 MB；ZIP 最大 60 MB。
- 不需自行加入外圍 margin；LINE 會自動加。
- 官方示例說明：上傳最大 396 × 660 後，加上平台 margin 的顯示區最大可成為 420 × 680。
- 構圖需利用大尺寸提高表現力，但仍不能因太細長而難以辨識。
- 商品說明會由 LINE 自動追加「在聊天中以加大尺寸顯示」的本地化提示。

## 全螢幕彈出貼圖

來源：

- [Pop-up stickers overview](https://creator.line.me/en/guideline/popupsticker/)
- [Creating pop-up stickers](https://creator.line.me/en/guideline/popupsticker/detail/)

這類商品同時包含一般聊天泡泡中的**靜態貼圖**，以及可在整個聊天畫面播放的
**pop-up APNG**。兩者不必使用相同圖像；APNG 第一格不會被拿來當靜態貼圖。

### 資產與動畫條件

| 資產 | 數量 | 尺寸 | 格式 |
| --- | ---: | --- | --- |
| Main image | 1 | 240 × 240 | PNG |
| Pop-up main image | 1 | 480 × 480 | APNG，以 `.png` 命名 |
| Static sticker images | 8、16 或 24 | 最大 370 × 320 | PNG |
| Pop-up images | 與靜態貼圖一一對應 | 最大 480 × 480 | APNG，以 `.png` 命名 |
| Chat thumbnail icon | 1 | 96 × 74 | PNG |

Pop-up APNG：

- 寬或高其中一邊必須正好 480 px。
- 寬為 480 時，高至少 320。
- 高為 480 時，寬至少 200。
- 最大 480 × 480。
- 5–20 frames。
- 單輪只可 1、2 或 3 秒。
- 最多 3 loops。
- `單輪秒數 × loops ≤ 3 秒`。
- RGB、透明背景。
- 每個 image 最大 1 MB；ZIP 最大 60 MB。
- 相同 frames 可能被 APNG 工具合併；全 frames 相同會上傳失敗。

### 畫面位置與構圖

- 可選 Top、Center、Bottom 三種垂直顯示位置。
- 若要讓直向畫面盡量滿版，官方舊裝置參考尺寸為：
  - iPhone 6／7／8：326 × 480。
  - iPhone 11／XR：274 × 480。
- 不同裝置長寬比不同，不能保證每台都完全滿版；上述數值也是假設直向。
- 靜態 sticker image 不需自行加 margin，LINE 會加。
- 官方示例中，最大 370 × 320 的靜態圖加上平台 margin 後，顯示區可成為 420 × 350。
- Pop-up image 與 pop-up main image 不會由 LINE 加 margin。
- 檔案大小控制原則與一般 APNG 相同：大面積漸層／背景動畫／細緻特效較重，
  平塗、限制色盤與合理重用 frame 較輕。

## 特效貼圖

來源：

- [Effect stickers overview](https://creator.line.me/en/guideline/effectsticker/)
- [Creating effect stickers](https://creator.line.me/en/guideline/effectsticker/detail/)

這類商品同時包含一般聊天泡泡中的**靜態貼圖**，以及在聊天背景播放的
**effect APNG**。Effect 可能被聊天泡泡或其他貼圖遮住，設計時需預留主要內容安全區。
靜態圖與 effect 不必相同；APNG 第一格不會被拿來當靜態貼圖。

### 資產與動畫條件

| 資產 | 數量 | 尺寸 | 格式 |
| --- | ---: | --- | --- |
| Main image | 1 | 240 × 240 | PNG |
| Effect main image | 1 | 480 × 480 | APNG，以 `.png` 命名 |
| Static sticker images | 8、16 或 24 | 最大 370 × 320 | PNG |
| Effect images | 與靜態貼圖一一對應 | 最大 480 × 480 | APNG，以 `.png` 命名 |
| Chat thumbnail icon | 1 | 96 × 74 | PNG |

Effect APNG 的尺寸、frame、時間、loop、RGB、透明、1 MB／60 MB 條件與
pop-up APNG 相同：

- 一邊正好 480 px。
- `480 × 高` 時高至少 320；`寬 × 480` 時寬至少 200。
- 最大 480 × 480。
- 5–20 frames。
- 單輪 1、2 或 3 秒；最多 3 loops；總播放不超過 3 秒。
- 可選 Top、Center、Bottom。
- 直向滿版舊裝置參考為 326 × 480 或 274 × 480，但不同裝置不保證滿版。
- 靜態貼圖由 LINE 加 margin；官方示例的 370 × 320 會成為 420 × 350 顯示區。
- Effect image 與 effect main 不會自動加 margin。

### Pop-up 與 effect 的差別

| 面向 | Pop-up | Effect |
| --- | --- | --- |
| 播放層級 | 跨整個聊天畫面、作為前景彈出 | 聊天畫面背景 |
| 遮擋重點 | 主要考慮裝置長寬比 | 另需考慮聊天泡泡與其他貼圖會蓋住內容 |
| 尺寸／時間 | 與 effect 相同 | 與 pop-up 相同 |

## Emoji

來源：

- [Emoji creation guidelines](https://creator.line.me/en/guideline/emoji/)
- [Set types and filenames](https://creator.line.me/en/guideline/emoji/detail/)

### 一般 emoji 技術條件

| 資產 | 數量 | 尺寸 | 格式 |
| --- | ---: | --- | --- |
| Chat thumbnail icon | 1 | 96 × 74 | PNG |
| Emoji images | 依 7 種套組類型 | 180 × 180 | PNG |
| Main display | 從已上傳 emoji 中選 4 個 | 不另上傳獨立 main 檔 | 由 LINE 組合 |

- 180 × 180 是固定尺寸。
- RGB、至少 72 dpi、透明背景。
- 每個 image 最大 1 MB。
- ZIP 必須**小於** 20 MB；官方一般 emoji 頁使用的是嚴格的 “less than”。
- 每個檔名需依套組類型使用指定三位數編號。
- 日文 kana 套組是為日文使用者設計的平假名／片假名套組。

### 顯示與設計建議

- Emoji 單獨送出時會像貼圖；與文字或其他 emoji 一起送出時會內嵌於對話泡泡。
- 盡量不留空白，讓主體在 180 × 180 內盡可能大；若有 margin 仍需保持可讀。
- 用粗、深色 outline，避免在不同聊天背景上消失。
- 表情要大且差異明顯；細微嘴型變化在 inline 顯示時可能完全看不出來。
- 簡化愛心、閃光、動態線等細節。
- 常用 emoji 排前面；多角色套組可按情緒分組，而不是先按角色分組。
- 增加角色元素與 pose 變化，避免整套單調。
- LINE 不會在相鄰 emoji 間插入空隙，因此可以設計連續拼圖。
- Letter emoji 反而應留適當 margin，避免相鄰字元黏在一起。
- 不建議只給單一姓名或單一個人使用的 emoji。

## 動態 Emoji

來源：

- [Animated emoji overview](https://creator.line.me/en/guideline/animationemoji/)
- [Creating animated emoji](https://creator.line.me/en/guideline/animationemoji/detail/)

套組類型、數量、180 × 180 固定尺寸、指定檔名、透明背景與主圖選 4 個的方式，
都與一般 emoji 相同。

### 動畫差異

| 項目 | 動態 emoji |
| --- | --- |
| Emoji 格式 | APNG，以 `.png` 命名 |
| 單圖上限 | 300 KB |
| ZIP 上限 | 20 MB 以下或等於 |
| Frames | 5–20 |
| 單輪播放 | 1、2、3 或 4 秒 |
| Loops | 1–4 |
| 總播放 | 不超過 4 秒 |
| Chat thumbnail | 96 × 74 靜態 PNG |

其他要求：

- 第一格需在靜態狀態下清楚表達情緒；動態 letter emoji 第一格必須讓字元清晰可辨。
- 所有 frames 相同會上傳失敗；重複 frame 可能被工具合併。
- 動畫在 inline 狀態很小，動態本身也需明顯；有文字時要特別注意可讀性。
- 官方偏好 margin 小、主體大、粗深 outline、表情清楚且動畫容易看見。

## Emoji 套組與檔名

[官方檔名頁](https://creator.line.me/en/guideline/emoji/detail/) 同時適用一般與動態 emoji。
副檔名為 `.png`，以下只列三位數 stem。

### 七種套組

| 套組類型 | 固定字元 | 可自由設計的 regular emoji | 總數 |
| --- | ---: | ---: | ---: |
| Regular Emoji | 0 | 8–40 | 8–40 |
| Kana + Letters/Numbers + Regular | 161 + 104 | 8–40 | 273–305 |
| Kana + Regular | 161 | 8–40 | 169–201 |
| Letters/Numbers + Regular | 104 | 8–40 | 112–144 |
| Kana + Letters/Numbers | 161 + 104 | 0 | 265 |
| Kana only | 161 | 0 | 161 |
| Letters/Numbers only | 104 | 0 | 104 |

### 編號配置

| 套組 | 固定區 | Regular 可用編號 |
| --- | --- | --- |
| Regular only | 無 | `001`–`040`，實際使用 8–40 個連續檔 |
| Kana + Letters/Numbers + Regular | Kana `001`–`161`；Latin/數字/符號 `162`–`265` | `266`–`305` |
| Kana + Regular | Kana `001`–`161` | `162`–`201` |
| Letters/Numbers + Regular | Latin/數字/符號 `001`–`104` | `105`–`144` |
| Kana + Letters/Numbers | Kana `001`–`161`；Latin/數字/符號 `162`–`265` | 無 |
| Kana only | Kana `001`–`161` | 無 |
| Letters/Numbers only | Latin/數字/符號 `001`–`104` | 無 |

### 固定字元順序

下面的順序就是編號順序。若字元區不是從 `001` 開始，例如完整 265 字元套組的 Latin 區，
把同一 104 字元序列平移到 `162`–`265`。

**Kana `001`–`161`：**

```text
001–017  あ い う え お か き く け こ さ し す せ そ た ち
018–034  つ て と な に ぬ ね の は ひ ふ へ ほ ま み む め
035–051  も や ゆ よ ら り る れ ろ わ を ん ぁ ぃ ぅ ぇ ぉ
052–068  っ ゃ ゅ ょ が ぎ ぐ げ ご ざ じ ず ぜ ぞ だ ぢ づ
069–085  で ど ば び ぶ べ ぼ ぱ ぴ ぷ ぺ ぽ ア イ ウ エ オ
086–102  カ キ ク ケ コ サ シ ス セ ソ タ チ ツ テ ト ナ ニ
103–119  ヌ ネ ノ ハ ヒ フ ヘ ホ マ ミ ム メ モ ヤ ユ ヨ ラ
120–136  リ ル レ ロ ワ ヲ ン ァ ィ ゥ ェ ォ ッ ャ ュ ョ ガ
137–153  ギ グ ゲ ゴ ザ ジ ズ ゼ ゾ ダ ヂ ヅ デ ド バ ビ ブ
154–161  べ ボ パ ピ プ ペ ポ ー
```

**Letters/Numbers `001`–`104`：**

```text
001–026  A B C D E F G H I J K L M N O P Q R S T U V W X Y Z
027–052  a b c d e f g h i j k l m n o p q r s t u v w x y z
053–062  1 2 3 4 5 6 7 8 9 0
063–079  〜 ! ? @ # $ % ^ & * ( ) + ÷ × = [
080–096  ] | ; : , . / < > _ - ¥ ・ 「 」 、 …
097–104  ♡ ♪ ↑ ↓ → ← ○ 〒
```

> 檢查提醒：`|` 在 Markdown 表格中容易被當成分隔符，`¥` 也可能因字型或 locale
> 顯示成反斜線。產圖與檔名 mapping 應以 Unicode 字元與官方頁面逐一比對。
>
> 官方英文頁在查證日把 Kana `154` 顯示為平假名 `べ`，雖然它位於片假名序列、
> 而且 `074` 已經是 `べ`。本文忠實保留這個官方頁面異常；實際製作 `154.png` 前，
> 應再用當下 My Page 或最新版官方 template 確認是否應畫成片假名 `ベ`。

## 主題

來源：

- [Themes overview](https://creator.line.me/en/guideline/theme/)
- [Complete creation guidelines](https://creator.line.me/en/guideline/theme/detail/)

### 先處理官方數量矛盾

查證日的官方資料同時存在以下三種說法：

1. Theme overview 標題寫 **Images (60)**，並列 **34 個 menu button images**。
2. 最新 detail 頁列出：
   - iOS 26：9 個 tab × OFF／ON = **18 張**。
   - iOS 26 以下與 Android：9 個 tab × OFF／ON = **18 張**。
   - 合計為 **36 張 menu button images**。
3. Creators Help Center 的 production flow 寫 **3 張 main + 58 張 theme images**，合計 61。

這些數字無法同時成立，應視為 iOS 26 過渡期的官方文件不同步，而不是擅自選一個數字。
實務優先順序：

1. 提交當下 My Page 顯示的 required／optional slots。
2. 當下最新版官方 PSD template。
3. 最新 detail 頁中的檔名和尺寸。
4. Overview 總數只作概覽，不用來產生 ZIP entry 白名單。

Detail 頁寫明 iOS 26 icon 會從 **2026 年 8 月**開始套用。頁面一方面稱審核時需要新 icon，
另一方面也說未建立時會顯示預設 icon；因此「是否立即為硬性必交」需由提交頁確認。

### 商品與流程

- 在 My Page 建立 Theme、填寫商品文字、上傳 ZIP。
- 上傳影像後選擇 color skin 與聊天背景色。
- 主題規格會隨 LINE 新版功能更新；舊商品未更新時可能由 LINE 使用預設或既有圖補位。
- 官方提供兼容 iOS 26 的 Photoshop template。
- Template 因使用 artboards，不支援 Photoshop CS6 或更舊版本。
- 原版或修改過的官方 template 都不得再散布。

### A. Main images

Main 背景不能透明，需為不透明圖。

| 平台／用途 | 數量 | 尺寸 | 檔名 |
| --- | ---: | --- | --- |
| iOS | 1 | 200 × 284 | `ios_thumbnail.png` |
| Android | 1 | 136 × 202 | `android_thumbnail.png` |
| LINE STORE | 1 | 198 × 278 | `store_thumbnail.png` |

### B. Menu button images

各服務／地區的 menu bar 可能不同，所以需準備所有列出的 tab。每個 tab 都有 OFF 與 ON 兩態。

#### iOS 26 及以上

- 每張 80 × 56。
- 通知 badge 為 32 × 32，由 LINE 自動疊加，不需提供資產。
- Badge 位於 image area 右上；橫向畫面可能與文字區重疊。
- Icon 必須在黑底與白底上都清楚。
- 上半身構圖可能因新版 image area 被裁；無 outline 或半透明、無底色圖也更容易融入背景。

| Tab | OFF | ON |
| --- | --- | --- |
| Home | `i_29_g.png` | `i_30_g.png` |
| Chats | `i_03_g.png` | `i_04_g.png` |
| Voom | `i_33_g.png` | `i_34_g.png` |
| Shopping | `i_35_g.png` | `i_36_g.png` |
| Calls | `i_07_g.png` | `i_08_g.png` |
| News | `i_25_g.png` | `i_26_g.png` |
| TODAY | `i_31_g.png` | `i_32_g.png` |
| Wallet | `i_27_g.png` | `i_28_g.png` |
| Apps | `i_37_g.png` | `i_38_g.png` |

#### iOS 26 以下與 Android

- 每張 128 × 150。
- 裁切內容周圍建議約 10 px margin。
- 通知 badge 為 33 × 33，由 LINE 自動疊加。
- 官方標示 badge 相對位置：上方 49 px、右方 21 px。

| Tab | OFF | ON |
| --- | --- | --- |
| Home | `i_29.png` | `i_30.png` |
| Chats | `i_03.png` | `i_04.png` |
| Voom | `i_33.png` | `i_34.png` |
| Shopping | `i_35.png` | `i_36.png` |
| Calls | `i_07.png` | `i_08.png` |
| News | `i_25.png` | `i_26.png` |
| TODAY | `i_31.png` | `i_32.png` |
| Wallet | `i_27.png` | `i_28.png` |
| Apps | `i_37.png` | `i_38.png` |

新舊 icon 應使用相同 menu 圖或相同 motif／design，再依各自框位縮放或裁切；
審核準則不接受不同 LINE 版本間的 icon 差異過大。

### C. Menu background

| 數量 | 尺寸 | 檔名 | 必要性 |
| ---: | --- | --- | --- |
| 1 | 1472 × 150 | `i_11.png` | Optional |

- 未提供時使用 color skin 或設定的背景色。
- 圖像向左對齊，需能水平無縫重複。
- Detail 頁的 required-image 表列 1472 × 150，但同頁 tips 又說高度可在 100–150 px。
  這是同一頁內的鬆緊差異；自動打包應優先產生表格尺寸，除非當下 uploader 明確接受較矮圖。
- 依 tips，低於 101 px 的背景不能透明；要透明需使用 101–150 px。
- 透明區的縫隙可能顯示成黑色，送審前需在 preview 檢查。

### D. Passcode images

四個數字位置各有 OFF／ON，iOS 與 Android 各一套，共 16 張。圖案可以四格相同，也可逐格不同。

| Digit | iOS OFF／ON，120 × 120 | Android OFF／ON，116 × 116 |
| ---: | --- | --- |
| 1 | `i_12.png`／`i_13.png` | `a_12.png`／`a_13.png` |
| 2 | `i_14.png`／`i_15.png` | `a_14.png`／`a_15.png` |
| 3 | `i_16.png`／`i_17.png` | `a_16.png`／`a_17.png` |
| 4 | `i_18.png`／`i_19.png` | `a_18.png`／`a_19.png` |

### E. Profile images

好友／群組沒有自訂頭像時使用。App 平常裁成圓形，但點開後四角會顯示，所以原圖仍需完整填滿矩形。

| 類型 | iOS，240 × 240 | Android，247 × 247 |
| --- | --- | --- |
| Individual | `i_20.png` | `a_20.png` |
| Group | `i_21.png` | `a_21.png` |

### F. Chat background

| 平台 | 數量 | 最小 | 最大／官方檔名 | 對齊 |
| --- | ---: | --- | --- | --- |
| iOS | 1 optional | 60 × 60 | 1482 × 1334，`i_22.png` | 置中、靠底；在輸入框上方 |
| Android | 1 optional | 60 × 60 | 1300 × 1300，`a_22.png` | 置中、靠底；延伸到輸入框下方 |

- 可透明也可不透明；透明圖會疊在 color skin 上。
- 每張 chat background 最大 1 MB。
- iOS 直向顯示區會成為 640 × 1334。
- Android 底部會被輸入框覆蓋，構圖需避開該區。
- 圖未填滿裝置畫面時，多出的區域使用 color skin；可用匹配背景色、匹配 color skin，
  或透明背景避免突兀接縫。

### Color skin

- 影像上傳後才能選 color skin。
- 可使用 color skin 預設聊天背景色，或另設背景色。
- 官方建議先下載 color skin template 比較，再開始設計。
- 官方示例以 `colorskin_brown.zip` 上傳到 Edit Theme，並在 Color Skins tab 檢查。

## 審核與內容限制

來源：[Sticker, Emoji and Theme Review Guidelines](https://creator.line.me/en/review_guideline/)

審核準則不是單純的機器規格。LINE 說明，命中以下類別的商品很可能被拒絕或下架；
但結果仍可能因內容、販售地區或創作者特性而不同。LINE 也保留自行判定不適當並限制、
暫停、變更或終止販售的權利。

### 類型特有的圖像審核

**貼圖：**

- 格式不符、日常難用、太細長或辨識度差、整套變化不足。
- 只有 logo、只有文字／片語、拼字錯誤。
- 標題與說明互相衝突。
- Main／tab 與實際商品內容明顯不一致。
- 與已上架或正在審核的貼圖重複。

**Emoji：**

- 格式不符、日常難用、可讀性差、拼字錯誤。
- 標題／說明矛盾；main／tab 與實際 emoji 不一致。
- 同一套內重複使用同一 emoji。
- 與已上架或正在審核的 emoji 重複。

**Theme：**

- 格式不符、icon 損壞／難辨／與背景混在一起。
- 整體缺乏一致主題或 balance，icon 只有文字。
- 整套只含文字／片語、拼字錯誤、標題與說明不符。
- 複製已上架／審核中的 theme；只做簡單換色也算。
- 不同 LINE 版本間的 icon 差異太大。

### 商品文字審核

三類商品共同會被檢查：

- 是否符合欄位格式。
- 拼字或其他錯誤。
- 標題／說明是否含廣告、上市日期、搜尋商品等導購文字。
- URL。
- 可能因裝置而顯示不同的 emoji 或字元。
- 過短而缺乏有效資訊的文字。
- 文案與商品圖像／theme 本身不一致。

### 道德與安全內容

貼圖與 emoji 的官方清單有 23 類；theme 清單有 22 類，theme 沒有另列一條
「過度性暗示的視覺／主題」，但仍明列露骨性內容。共同禁止或高風險內容可整理為：

1. 鼓勵犯罪。
2. 暴力、兒虐或兒童色情。
3. 過度性暗示（貼圖／emoji 明文另列）。
4. 過量飲酒、非法藥物、鼓勵未成年飲酒或吸菸。
5. 酒駕。
6. 寫實非法武器或鼓勵使用。
7. Spam 或 phishing。
8. 寫實描繪謀殺、槍擊、刺殺或虐待人／動物。
9. 誹謗、傷害或攻擊個人、法人、國籍或群體名譽。
10. 洩漏本人或第三人的個資。
11. 過度冒犯或粗俗。
12. 攻擊或嚴重冒犯宗教、文化、族群或國籍。
13. 傳教、招募宗教，或宗教色彩過強。
14. 政治圖像或選舉內容。
15. 刻意造成混亂或噁心。
16. 性露骨內容。
17. 鼓勵賭博或賭博元素。
18. 試圖取得密碼或私密資料。
19. 不利未成年人健全發展的內容，例如吃角子老虎機或賽馬。
20. 鼓勵自殺、自傷或藥物濫用。
21. 鼓勵霸凌。
22. 促進歧視。
23. 其他反社會、可能令使用者不適的元素。

### 商業、廣告與其他限制

- 不得要求購買者提供個資或 ID。
- 不得超越私人使用範圍，藉免費／付費散發為第三方帶來利益，例如到店贈送的企業活動。
- 不得引用其他 messenger app、類似服務或其角色。
- 不得做商業廣告／促銷，例如徵才服務。
- 不得募款做慈善。
- 不得募集捐款或鼓勵加入政治、宗教、反社會等組織。
- 製作準則另明確說明，付費商品的圖、標題與說明不能用於廣告、公布上市／活動日期，
  也不能塞入不必要的企業 logo。

### 權利與法律

- 不得侵害 LINE／LY Corporation 或第三方的商標、著作權、專利或素材使用條件。
- 避免權利人不明的二次創作。
- 未經本人同意使用臉部照片或 caricature 可能侵害肖像權。
- 使用素材需能證明獲得權利人許可。
- 必須遵守販售地區法律，不得侵害第三方權利或利益。
- 使用照片時，LINE 可能要求權利證明。人物、角色、logo、名人等照片尤其應備妥
  License Certificate、權利人授權或可驗證權利的文件。

## 提交、照片、標籤與上架後限制

來源：

- [Creators Help Center: Stickers](https://help2.line.me/creators/web/categoryId/20002324/3/pc?lang=en)
- [Creators Help Center: Emoji](https://help2.line.me/creators/web/categoryId/20005266/3/pc?lang=en)
- [Creators Help Center: Production flow](https://help2.line.me/creators/web/categoryId/20002327/3/pc?lang=en)

### 通用送審流程

1. My Page 選 New Submission。
2. 選商品類型。
3. 登錄 title、description、creator、copyright；需要時準備各語言翻譯。
4. 上傳規定圖像；emoji 再從已上傳內容選 4 個作 main display。
5. 需要權利證明時附 License Certificate 與可確認原作的 URL。
6. Stickers／emoji 送審時閱讀並同意 Terms of Agreement；未勾同意不能提交。
7. 按 Request 進入審核。

### 照片

- 可以使用照片。
- Product details 中應正確標示 Includes Photos。
- 照片若含角色、logo、名人或其他權利標的，附上 License Certificate 或其他授權證明。
- 審核方可要求進一步的使用權文件。

### Tag settings

- 一般貼圖與 emoji 可為每一 item 選最多 9 個 tags，讓使用者輸入相關字詞時出現在建議。
- Tag 可按語言設定；tag 旁的數字代表支援語言數。
- 已核准的 tag 更新通常在 24 小時內套用。
- 不相關或不適當的 tag 可能被 LINE 移除。
- Message sticker 不提供 tag settings；其建議機制依使用者曾送出的 message text。

### 送審與上架後

- 套組數量送審後不可更改。
- 商品通過審核後，貼圖、emoji 與 theme 的圖像不可再編輯或替換。
- 因此送審前不只要跑格式驗證，也應在 My Page preview、聊天背景、靜態第一格及實機小尺寸顯示中複查。
- LINE 在上架處理時可能自動縮放，造成顏色或細節略變；官方 Help Center 建議減色、減小檔案，
  並選 sRGB color profile 來降低差異。

## 與 sticker-tool 的關係

截至查證日，專案的 deterministic runtime 只支援：

- 一般靜態貼圖。
- 動態貼圖。

目前**不代表已支援**自訂、訊息、大貼圖、全螢幕彈出、特效、emoji、動態 emoji 或 theme。
這些類型需要不同資產集合、尺寸、style editor metadata 或平台檔名，不能只把一般貼圖尺寸改大就宣稱支援。

本專案現有規格與驗證入口：

- [`src/core/spec.ts`](../src/core/spec.ts)：一般靜態／動態貼圖數值常數。
- [`src/core/validate.ts`](../src/core/validate.ts)：共用 metadata validation。
- [`ARCHITECTURE.md`](../ARCHITECTURE.md)：CLI／browser 邊界與驗證信任範圍。
- [`plan/implementation-audit.md`](../plan/implementation-audit.md)：已知合規落差與實測探針。

目前一般／動態貼圖 ZIP 的專案慣例是 `main.png`、`tab.png`、`01.png` 起的兩位數序號。
不要把這套命名直接外推到 pop-up、effect、emoji 或 theme；後者各有額外資產或另一套編號規則，
而本專案尚未實作其完整 package contract。

使用本工具時需保留以下判斷：

- `validation ok` 只是目前 metadata 檢查沒有發現問題，不是 LINE 審核保證。
- Alpha channel 存在不等於背景真的透明。
- 尺寸與 bytes 合法不代表圖不空白、沒有殘底、第一格表意清楚、動畫確實有變化。
- LINE uploader 可能採用本文未能從公開頁面確認的額外解析或壓縮行為。
- 商品內容、商標、著作權、肖像權、廣告與地區審核不屬 deterministic image validator 能證明的範圍。

## 官方來源索引

### 貼圖

- 一般貼圖：https://creator.line.me/en/guideline/sticker/
- 動態貼圖：https://creator.line.me/en/guideline/animationsticker/
- 動態貼圖細節：https://creator.line.me/en/guideline/animationsticker/detail/
- 自訂貼圖：https://creator.line.me/en/guideline/customsticker/
- 自訂貼圖細節：https://creator.line.me/en/guideline/customsticker/detail/
- 自訂／訊息貼圖字型：https://creator.line.me/en/guideline/customsticker/font/
- 訊息貼圖：https://creator.line.me/en/guideline/messagesticker/
- 訊息貼圖細節：https://creator.line.me/en/guideline/messagesticker/detail/
- 訊息貼圖 sample text：https://creator.line.me/en/guideline/messagesticker/sampletext/
- 大貼圖：https://creator.line.me/en/guideline/bigsticker/
- 全螢幕彈出貼圖：https://creator.line.me/en/guideline/popupsticker/
- 全螢幕彈出貼圖細節：https://creator.line.me/en/guideline/popupsticker/detail/
- 特效貼圖：https://creator.line.me/en/guideline/effectsticker/
- 特效貼圖細節：https://creator.line.me/en/guideline/effectsticker/detail/

### Emoji

- 一般 emoji：https://creator.line.me/en/guideline/emoji/
- 套組與檔名：https://creator.line.me/en/guideline/emoji/detail/
- 動態 emoji：https://creator.line.me/en/guideline/animationemoji/
- 動態 emoji 細節：https://creator.line.me/en/guideline/animationemoji/detail/

### Theme、審核與 Help Center

- Theme overview：https://creator.line.me/en/guideline/theme/
- Theme complete detail：https://creator.line.me/en/guideline/theme/detail/
- 全類型審核準則：https://creator.line.me/en/review_guideline/
- Stickers Help Center：https://help2.line.me/creators/web/categoryId/20002324/3/pc?lang=en
- Emoji Help Center：https://help2.line.me/creators/web/categoryId/20005266/3/pc?lang=en
- Production flow：https://help2.line.me/creators/web/categoryId/20002327/3/pc?lang=en

## 維護建議

每次修改 `src/core/spec.ts`、新增商品類型或準備正式送審前，至少重新查看：

1. 對應商品的 overview。
2. 對應 detail 頁。
3. Review Guidelines。
4. My Page 實際 upload slots 與錯誤訊息。
5. Theme 類型另外檢查最新 PSD template 與 iOS 版本公告。

更新本文件時應修改查證日期，並明確記錄官方頁面間的矛盾；不要用推測把矛盾消掉。
