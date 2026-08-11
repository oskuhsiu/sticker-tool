# 邊界連通去背：保留主體中的背景同色區域

> 狀態：安全預設仍是外框四向連通與三種邊緣策略；Web 另提供明確 opt-in 的全圖色碼模式，以 0.0%–20.0% 容差硬挖所有符合像素。Video 編輯器會用最多三張代表候選 frame 即時預覽。互動式保留／去除修正仍是後續提案。零提示模型比較已加入實驗性 Colab Notebook。

## TL;DR

- 預設的單色色鍵只刪除顏色接近背景、而且能以四向路徑連到畫面外框的區域。
- 使用者可明確改選「全圖色碼」：0.0% 只挖完全相同 RGB，最高 20.0%；主體內符合的像素也一定會被挖掉。
- Video 會從目前目標格數的初選候選取最多三張，讓使用者切換並即時查看容差造成的透明結果。
- 邊緣可選「清除色暈」（預設）、「柔和邊緣」或「硬邊」；硬邊不留 soft matte，代價是鋸齒或輪廓縮小。
- 如果主體同色區域直接碰到背景，且中間沒有任何可辨認的色差或邊界，單靠像素無法可靠判斷，必須使用保留／去除筆畫、前景框選或乾淨背景參考圖。

## 問題

舊版 Web 的 `chromaKeySolid` 使用固定背景色，計算每個像素與背景色的 Chebyshev 距離：距離不超過 20 時完全透明，20–64 之間產生漸層 alpha。它把這個固定 soft 規則套到全圖，沒有 0–20% 明確容差或調參預覽，因此主體內相近色會在不易察覺的情況下消失。舊 Project 的這類成品仍不會被當成安全成品繼續使用；新全圖模式是不同、需使用者明確選取並預覽的二值色碼契約。

語意去背則有另一種失敗模式：模型理解的是主要前景，不是使用者想保留的所有像素。文字、粒子、光效、小道具或與角色分離的元素仍可能被分類成背景。

## 已實作的第一階段

單色色鍵與三種邊緣選項共用以下流程：

1. 從四角與畫面邊界取樣，建立背景顏色範圍；亦允許使用者手動點選背景。
2. 根據顏色距離產生「可能是背景」的候選遮罩，容許近純色背景中的雜訊與壓縮色差。
3. 從四條邊開始 flood fill，只標記與邊界連通的候選背景。
4. 不與邊界連通的相似色像素維持前景，因此主體內被輪廓包住的同色區域不會因顏色相同而消失。
5. 依邊緣選項套用既有的顏色距離 soft matte、去除合成背景色，或把候選直接設為透明。第一階段沒有加入空間 blur／morphology，避免擴張到不符合色差條件的主體。

第一版保持本機、確定性且不依賴新模型。平台中立的邊緣選項契約位於 `src/core/colorKey.ts`；像素 Raster 實作留在 Web adapter。這些選項只屬於單色色鍵，不會顯示或傳給 IMG.LY、BiRefNet、Colab 或不去背模式。

## 目前 UI

- 去背範圍：`外框連通（安全預設）`／`全圖色碼（符合就挖掉）`
- 外框連通的邊緣處理：`清除色暈（建議）`／`柔和邊緣（可能留背景圈）`／`硬邊（可能鋸齒）`
- 全圖色碼容差：`0.0%–20.0%`、step `0.1%`，並提供 `−0.1%`／`+0.1%` 微調按鈕
- 背景取樣：工作流既有的自動偵測、色彩輸入或手動點圖取色
- Video 即時預覽：最多三張初選代表 frame，可切換查看處理前／處理後與挖除 pixel 數
- 後續增強：`保留筆刷`與`去除筆刷`

保留筆刷若只是直接恢復來源像素，使用者仍需大致覆蓋要保留的區域；若希望只畫幾筆便自動擴張到完整物件，則需增加 GrabCut 或 promptable segmentation 類型的互動式分割。

## 適用範圍與限制

| 情況 | 預期結果 |
| --- | --- |
| 近純色背景有少量亮度、雜訊或壓縮差異 | 可用容差移除 |
| 主體內有被輪廓包住的背景同色區域 | 外框連通保留；全圖色碼會依容差挖除 |
| 文字、粒子或小物件與背景不同色 | 保留，不依賴語意模型 |
| 同色前景直接碰到背景，但仍有可辨認邊緣 | 可加入 edge barrier 或人工保留筆畫降低漏刪 |
| 前景與背景同色、相連且沒有任何影像邊界 | 無法從單張像素可靠區分，必須加入使用者提示、時間資訊或乾淨背景參考圖 |

影片應對每個實際候選 frame 使用相同取樣規則與參數，並沿用目前「先選 frame，再去背」的管線。後續若遮罩抖動明顯，再考慮前一幀遮罩或光流作時間穩定，不應在第一版混入。

## 替代與增強方案

邊界連通只能自動處理所有背景都碰得到畫面邊緣的情況。沒有任何方法能只靠一張圖片，自動且保證正確地區分兩組顏色、紋理與邊界都完全相同的像素；其他方法的差別，在於引入哪一種額外線索。

| 方法 | 額外線索 | 能解決的情況 | 代價或限制 |
| --- | --- | --- | --- |
| 多起點背景選取（Magic Wand） | 使用者在背景區域點一下 | 背景被主體切成多個、不與外框連通的區塊 | 每個無法連通的背景區至少需要一個點；影片需傳播或重點選 |
| GrabCut／trimap | 前景框及少量前景／背景筆畫 | 前景與背景近色、拓撲複雜、包含多個分離元素 | 需要互動；邊界品質仍需 matting |
| Promptable segmentation（如 SAM 2） | 點、框或遮罩指定要保留的物件 | 直接選前景，不要求背景連到外框；可跨影片追蹤 | 模型較重；文字、粒子、光效等分離元素可能要分別指定 |
| 乾淨背景參考圖 | 同場景、沒有主體的背景影像 | 背景不均、陰影或不連通區域；固定鏡頭尤其有效 | 使用者必須能提供 clean plate；鏡頭移動時要先對齊 |
| 影片時間背景模型 | 多個 frame 的變化 | 某一格被主體包住的背景，可能在其他格露出，可由時間中位數或背景模型恢復 | 適合固定或可穩定對齊的背景；一直被遮住的位置仍未知 |
| 通用保留／去除遮罩 | 使用者直接指定最終意圖 | 可修正任何自動方法的剩餘錯誤 | 最可靠但人工量最高；簡單筆刷需大致覆蓋完整區域 |

### 多起點背景選取

這是邊界連通去背最小且最實用的延伸：預設以四邊作為背景 seed；如果畫面中有被主體包住的背景洞，使用者只需在洞內點一下，系統便以相同的顏色容差 flood fill 該連通區。它不會因為全圖其他位置具有相同顏色就一併刪除。

這種操作不是要求使用者完整塗遮罩，而是每個錯過的背景區域點一下。若點錯，應能單步復原；另提供「保留點」阻止 flood fill 穿過不確定區域。

### 前景物件選取

另一條路是反過來指定「要保留什麼」。GrabCut 可由一個前景框開始，再用少量前景／背景筆畫收斂；SAM 2 類型的模型則可用點、框或既有遮罩指定物件並在影片中追蹤。兩者都不要求背景連到外框，但與角色分離的文字、粒子或光效仍可能需要額外提示。

### 背景參考與時間資訊

如果來源是影片且背景固定，最強的非語意線索通常是背景本身：讓使用者提供一張沒有主體的 clean plate，或從多個 frame 建立時間背景模型。這能判斷被主體切成獨立區塊的背景，不必依賴外框連通；鏡頭若移動，必須先做影像對齊。

## 建議的完整產品流程

不建議只提供一個號稱全自動的新模型，而應採分層流程：

1. **自動層**：邊界連通近色去背，安全處理大多數背景。
2. **快速修正層**：使用者點擊漏掉的背景區塊；一次點擊擴張到整個連通區，不必畫滿。
3. **歧義處理層**：以保留點／筆畫標記主體中的同色區域，必要時交給 GrabCut／trimap 細分。
4. **影片層**：將點、遮罩或物件追蹤結果傳播到其他候選 frame，只在追蹤失敗的 keyframe 要求修正。
5. **精修層**：最後才做窄邊界 matting、羽化與 spill suppression。

這個組合的重點不是追求單一演算法覆蓋 100%，而是讓約 90% 的情況自動完成，剩餘情況通常只需一至數次點擊，而不是逐像素畫完整遮罩。

## 驗收條件

- 帶有小幅 RGB 波動的近純色背景能完整變透明。
- 外框連通模式中，與背景顏色相同但被主體輪廓包住的測試區域保持不透明。
- 全圖色碼 0.0% 只挖完全相同 RGB；10.0% 與 20.0% 使用相同 Chebyshev 百分比邊界。
- Video 容差 slider、0.1% 微調與代表 frame 切換必須即時更新 Canvas，不重新編碼 APNG。
- 來源既有的半透明 alpha 不得增加，只能維持或降低。
- 邊界不得出現明顯鋸齒、背景色洞或大範圍漏刪。
- 相同輸入與設定必須產生相同遮罩。
- 圖片與 Video→APNG 共用相同規則；影片只處理已選候選 frame，必要替補除外。
- 對「完全無法由像素區分」的案例，UI 必須揭露限制，不宣稱能自動保留。

## 參考資料

- [OpenCV floodFill：從 seed 填滿符合條件的連通區域](https://docs.opencv.org/4.12.0/d7/d1b/group__imgproc__misc.html)
- [OpenCV GrabCut：以前景框與前景／背景筆畫做互動式分割](https://docs.opencv.org/4.12.0/d8/d83/tutorial_py_grabcut.html)
- [Background Matting: The World is Your Green Screen](https://arxiv.org/abs/2004.00626)
- [Meta Segment Anything Model 2](https://ai.meta.com/research/sam2/)

## 模型選項研究：近純色背景、同色前景與 Video→APNG

本節同時記錄模型選型研究與目前實驗性 Colab adapter 的落地範圍。這裡的「模型」都是電腦視覺的
segmentation／matting 模型，不是 LLM：它們會從影像推測 mask 或 alpha，卻沒有一個
「使用者想保留的每一個像素」輸入，也沒有零互動就永遠正確的保證。模型 benchmark
不能取代本專案對文字、粒子、光效與分離小物件的 fixture 驗收。

### 目前 Colab Notebook 的實作範圍

`examples/colab/sticker-tool-birefnet-colab.ipynb` 現在把符合「單張 PNG → 同尺寸灰階
alpha mask」的候選模型統一成相同 endpoint。檔名與 `colab-birefnet` route 暫時保留以維持
相容性；使用者看到的名稱已改成「Colab 多模型去背」。選單共有以下 13 個選項：

| 類別 | Notebook 選項 | 定位 |
| --- | --- | --- |
| BiRefNet general | `birefnet-lite`、`birefnet-full`、`birefnet-dynamic` | lite 是推薦起點；full 較重；dynamic 保留長寬比 |
| BiRefNet matting | `birefnet-lite-matting`、`birefnet-matting`、`birefnet-dynamic-matting` | 比較細緻 alpha／髮絲；訓練偏人物，仍可能排除分離文字與裝飾 |
| 另一個通用模型 | `ben2-base` | BEN2 Base，內部 1024；不包含商業版 full refiner |
| 人物專用 | `modnet-portrait` | 固定 revision 的 ONNX MODNet；只適合真人肖像，不是通用貼圖模型 |
| 插畫／通用顯著物件 | `isnet-general`、`isnet-anime` | ONNX；anime 可與 general 對動漫素材做 A/B，但兩者都不是文字感知模型 |
| 傳統輕量基準 | `u2net`、`u2netp` | 方便比較顯著物件偏差；U2NetP 速度優先、通常犧牲細節 |
| 授權受限實驗 | `rmbg-2.0` | 官方 gated 權重；釘選 revision 使用 `bria-rmbg-2.0` 自訂授權，只在勾選非商用評估確認並由 Colab Secrets 提供 `HF_TOKEN` 時載入 |

每次只載入一個 Torch 或 ONNX model，避免所有模型同時佔滿 T4 VRAM。切換不是處理中的
零停機替換，而是**同一台 VM 內的快速重啟**：

1. 先完成或取消 sticker-tool 目前這一批，停止 Notebook 最後一個 API cell。
2. 改 `MODEL_CHOICE`，再選 Runtime → Run all。
3. 不必 Disconnect 或 Delete runtime；同一 VM 的 pip 與模型磁碟快取會保留，未下載過的權重才補抓。
4. 舊模型、ONNX session、Uvicorn 與 tunnel 會先釋放，再只載入新模型。
5. Run all 會產生新的 Quick Tunnel URL、session key 與 generation；必須重新貼回網站，舊連線不可沿用。

網站重新設定連線時會中止仍在進行的 request，並讓舊 Colab 模型產生的 Video cache／current
render 失效，避免同一批 APNG 靜默混用兩個模型。URL、session key 與 generation 都不寫入
Project ZIP。RMBG 的 `HF_TOKEN` 只由 Colab 自己讀取，不會印出或傳給 sticker-tool。

沒有放入同一選單的項目不是「模型不能用」，而是輸入契約不同：IMG.LY 已是瀏覽器本機選項；
SAM 2/3 需要點、框、文字或 mask prompt；ViTMatte/FBA 需要 trimap；Background Matting V2
需要 clean plate；RVM 需要連續人物影片狀態。若把它們假裝成無提示的單張去背，會失去其真正
優勢，也會讓使用者誤以為模型已知道要保留哪些字、emoji 或特效。

目前 repository 已驗證 Notebook 生成一致性、Python code-cell syntax、adapter registry／分派的
靜態契約、mask HTTP contract、連線 generation 與 cache invalidation；尚未在這個開發環境實際取得 Colab T4
逐一下載並跑完 13 個模型。因此 T4 的載入時間、峰值 VRAM、CUDA provider 相容性與實際畫質，
仍需以乾淨 runtime 做實機測試，不能從靜態測試宣稱全部已通過。

### IMG.LY 這類模型做不做得到？

它**可能比單色色鍵做得更好，但不能被要求保證做到**。IMG.LY 不是逐像素比對背景色，
因此有機會依主體輪廓與影像內容保住主體中的背景同色區域；問題是目前專案釘選的
`@imgly/background-removal` v1.4.5 只接受一張 image，設定只有資產／runtime、
`small | medium` model 與 output 等選項，沒有 points、box、trimap、文字 prompt 或
protected mask。也就是說，使用者無法告訴它「這段文字、這些粒子與這個光效一定要留」。

所以 IMG.LY 應被視為 zero-prompt 的**候選 mask 產生器**：結果好就直接採用；結果漏掉
元素時，必須交給多起點選取、保留／去除修正，或改用 SAM 類可提示式分割。這個限制
可由[目前 Web adapter](../web/src/webpipe/removeBackground.ts)與
[官方設定介面](https://github.com/imgly/background-removal-js/blob/main/packages/web/README.md#advanced-configuration)
直接確認。

先把問題拆成三件事，能避免把「邊緣變漂亮」誤當成「知道哪些元素要保留」：

| 問題 | 真正需要的線索 | 適合的方向 |
| --- | --- | --- |
| 哪些區域是前景，尤其是被背景切開的同色區域或分離物件？ | 邊界連通關係、使用者提示、乾淨背景差分或物件追蹤 | 本文件的 flood fill、保留／去除點筆刷、clean plate、SAM 2/3 |
| 已選中的輪廓，哪些像素是半透明或有毛邊？ | trimap／unknown band、前景與背景顏色模型 | ViTMatte、FBA、Background Matting V2 的 alpha refinement |
| 多張 Video→APNG 畫格如何不閃爍？ | 時間記憶、mask propagation，或跨格一致的人工修正 | SAM 2/3 video predictor、RVM；單張模型則需自行快取與檢查 |

### 選項比較

| 選項 | 官方輸入／輸出與部署證據 | 對同色區域、文字、粒子、光效、分離小物件 | Video→APNG 與限制 | 授權與實務注意 |
| --- | --- | --- | --- | --- |
| **IMG.LY `@imgly/background-removal`** | 官方瀏覽器套件以單張 image input 產生 PNG foreground／mask，並可在瀏覽器本機執行；目前專案釘選版本的設定只有資產／runtime、model、output 等，沒有 points、boxes、trimap 或 protected-mask 的互動介面。官方文件列出 small 約 40 MB、medium 約 80 MB，首次下載後由 browser cache 保存。([官方 browser README](https://github.com/imgly/background-removal-js/blob/main/packages/web/README.md)) | zero-prompt 語意去背可能保住主要輪廓，但不能命令它保留指定的背景同色字、粒子或 glow；低顯著度、細小、與主體分離的元素仍是風險。它不能解開「同色且沒有邊界」的資訊歧義。 | 官方套件契約是 image，不是有時間記憶的 video matting；Video→APNG 只能逐格呼叫，再自行做候選 frame、cache 與 flicker 檢查。 | 軟體為 **AGPL**；官方說其他授權需聯絡 IMG.LY。模型/WASM 預設由 IMG.LY 提供，也可自行 host。([官方授權與資產說明](https://github.com/imgly/background-removal-js/blob/main/packages/web/README.md#license)) |
| **BiRefNet（目前模型家族）** | 官方實作是 high-resolution dichotomous image segmentation，且 model zoo 同時提供 general、`BiRefNet-matting`、dynamic／high-resolution 與 ONNX/Colab 路徑；官方報告標準 1024² FP16 在 RTX 4090 約 3.45 GB GPU memory，並說 ONNX 轉換在其測試中較慢。([官方 repo/model zoo](https://github.com/ZhengPeng7/BiRefNet#model-zoo)) | 比單純色鍵更能依輪廓和語意推測主要前景，可能保住主體內的同色區域；但輸出仍是模型推測，不是使用者的元素清單，因此文字、粒子、光效、分離小物件可能被當成背景。沒有 prompt 來逐項「保留」。 | 官方有 video inference notebook，但這是把圖像模型套到影片候選格；沒有 SAM 式的互動追蹤記憶。逐格使用時必須在本專案層做 mask cache、時間抖動預覽與 keyframe 修正。 | 官方程式庫 LICENSE 是 **MIT**。目前瀏覽器使用的 `studioludens/birefnet-lite-512` 是 512² ONNX 衍生匯出：模型卡列出 fp16 約 94 MB，並說 1024² ONNX 在其測試瀏覽器 backend 會 OOM；這是衍生匯出的部署證據，不是所有 BiRefNet 變體的保證。([官方 BiRefNet LICENSE](https://github.com/ZhengPeng7/BiRefNet/blob/main/LICENSE), [512 browser model card](https://huggingface.co/studioludens/birefnet-lite-512)) |
| **BRIA RMBG 2.0** | 官方 model card 稱它是 dichotomous image segmentation，輸出單通道 8-bit grayscale alpha；提供 1024² PyTorch 範例、Transformers.js 範例，並列出 0.2B parameters。訓練資料分布包含多物件前景、含文字與 text-only 類別，但那不是對任意輸入的保留保證。([官方 model card](https://huggingface.co/briaai/RMBG-2.0)) | 可能比舊式 salient-object 模型更能處理一般物件與文字場景，但仍是 zero-prompt 前景推測；訓練資料有「含文字」不等於會保留本案例的每一個 glyph、粒子或光暈。 | 沒有官方 video tracking/matting API；可逐格使用但要自行處理 temporal consistency。Transformers.js 範例證明可接 web runtime，沒有提供本專案硬體上的記憶體／速度保證。 | 本 Notebook 釘選的 revision metadata 是 **`license: other`／`license_name: bria-rmbg-2.0`**，連到 BRIA 自訂協議；不可把它誤寫成標準 CC 授權，也不可直接推定具有商業權利。本 Notebook 額外限制為非商用評估，商用需另行確認。([釘選 revision metadata](https://huggingface.co/api/models/briaai/RMBG-2.0/revision/8466043b7b29ea0e0d1f4cc95b2bca1f5fcf8ae0)) |
| **BEN／BEN2** | BEN 的核心是 Confidence Guided Matting：base model 後以 refiner 處理低信心像素；官方 BEN card 列 BEN base **94M parameters**，BEN2 repo 提供 base、ONNX 與 `segment_video` 範例，並稱 full refiner 另有商用存取。([BEN model card](https://huggingface.co/PramaLLC/BEN), [BEN2 官方 repo](https://github.com/PramaLLC/BEN2)) | confidence-guided refinement 有助於毛髮、邊緣與半透明邊界，但它仍先猜「前景是什麼」；不能從同色像素本身知道哪些是字、粒子或 glow，也沒有保留點／物件 prompt。 | 官方提供影片分割函式，但範例是批次逐格處理，並非帶使用者修正的 tracking memory；要用在 APNG 仍需自行檢查 mask 漂移。 | BEN/BEN2 **程式碼 repo 是 MIT**；BEN 的 Hugging Face model card 顯示 Apache-2.0，應把 code 與 weights 條款分開審核。BEN2 repo 說 base model open source、full commercial model 要聯絡取得；在確認 weights 條款前不應打包進產品。([BEN LICENSE](https://github.com/PramaLLC/BEN/blob/main/LICENSE), [BEN2 LICENSE](https://github.com/PramaLLC/BEN2/blob/main/LICENSE), [BEN model card license](https://huggingface.co/PramaLLC/BEN#license)) |
| **MODNet／U²-Net（輕量代表）** | MODNet 官方定位是只用 RGB 的 real-time **portrait** matting，並提供 portrait video demo；程式、模型與 demo（排除指定 GIF）為 Apache-2.0。U²-Net 官方定位是 salient-object detection，完整 `u2net.pth` 約 176.3 MB、`u2netp.pth` 約 4.7 MB。([MODNet repo](https://github.com/ZHKKKe/MODNet), [U²-Net README/model sizes](https://github.com/xuebinqin/U-2-Net#usage-for-salient-object-detection)) | MODNet 的人像專域不適合把貼圖的字、粒子、glow、道具全部視為前景；U²-Net 輕量但 salient-object 偏向主要顯著物。兩者都沒有使用者意圖或多物件保留 prompt。 | MODNet 有人像 video demo，U²-Net 是逐張 salient mask；兩者都不能替代一般 sticker art 的時間一致性。 | MODNet 官方標示 Apache-2.0；U²-Net 官方 [LICENSE](https://github.com/xuebinqin/U-2-Net/blob/master/LICENSE) 也是 Apache-2.0。較小權重可能適合 Colab/實驗，但不能由檔案大小推導品質或瀏覽器可靠性。 |
| **SAM 2** | Meta 官方把它定義為 promptable image/video segmentation：可在影像或任一 video frame 以 click、box、mask 選物件，並用 session memory 追蹤、在其他 frame 加修正。([Meta SAM 2](https://ai.meta.com/research/sam2/), [official repo video predictor](https://github.com/facebookresearch/sam2#video-prediction)) | 這是本案例第一個真正能把「要保留的主體／文字／粒子／光效／小物件」交給使用者逐一指定的方向；但每個分離元素可能需要額外 prompt，輸出是 segmentation mask，不是天然的高品質 alpha matte。沒有 prompt 就不是 zero-interaction 保證。 | 最適合 Video→APNG 的 keyframe mask propagation；仍應在追蹤失敗或元素出現／消失處要求修正，且 union／subtract 的 component policy 要由產品定義。 | 官方 code、checkpoints、demo 與 training code 為 Apache-2.0；官方 repo 未提供本專案所需的 browser WebGPU 契約。可先作 Colab／桌面互動工具，不宜直接放入 deterministic runtime。 |
| **SAM 3／3.1（較新官方選項）** | Meta 官方稱 SAM 3 可用 text phrase、image exemplar、points、boxes、masks 在 image/video 偵測、分割與追蹤，並能找出概念的所有 instances；README 記載 2026-03-27 的 SAM 3.1 Object Multiplex shared-memory multi-object tracking。([Meta SAM 3 paper page](https://ai.meta.com/research/publications/sam-3-segment-anything-with-concepts/), [official repo](https://github.com/facebookresearch/sam3#latest-updates)) | text/exemplar prompt 可比 SAM 2 更直接地指定「文字／粒子」等概念，但仍是概念分割，不是 alpha matting；字形、半透明 glow 或非語意小物件仍需 visual prompt／人工修正。 | SAM 3/3.1 的 detector + tracker 路徑適合以少量 keyframe prompt 追蹤多個 component，再把 mask 傳給本專案 APNG 逐格處理。 | 官方安裝要求 Python 3.12+、PyTorch 2.7+、CUDA 12.6+，且使用 checkpoints 前要申請 Hugging Face access；SAM 3 使用自己的 SAM License（不是 SAM 2 的 Apache 宣告）。因此目前只適合明確的 Colab／桌面進階 workflow，不能假設瀏覽器可部署。([SAM 3 prerequisites](https://github.com/facebookresearch/sam3#installation), [SAM 3 License](https://github.com/facebookresearch/sam3/blob/main/LICENSE)) |
| **ViTMatte／FBA 等 trimap alpha matting** | ViTMatte 官方文件明確要求 image 與 trimap 串接輸入，輸出 image alpha matte；官方 repo 有 ViTMatte-S/B，MIT code。FBA 官方 repo 提供 foreground、background、alpha，並示範製作 trimap。([ViTMatte official repo](https://github.com/hustvl/ViTMatte), [Transformers ViTMatte input contract](https://huggingface.co/docs/transformers/model_doc/vitmatte), [FBA official repo](https://github.com/MarcoForte/FBA_Matting)) | 這類模型很適合在**已經決定保留哪些元件**後，精修 hair、半透明粒子、glow 邊緣；trimap 不負責決定「被背景切開的同色區域是否是前景」，所以仍需 flood fill、SAM 或保留筆畫。 | ViTMatte/FBA 是 image matting，不能單獨提供影片 tracking；對 APNG 應只在選定 frame 或 keyframe refinement 使用，並自行維持 temporal consistency。 | ViTMatte repo 為 MIT；FBA README 指出其 139 MB 模型受 Adobe Image Matting Dataset 條款限制，只能 noncommercial，且高解析 inference 需要至少 11 GB GPU memory。這使 FBA 不適合直接放入商用預設。([FBA model/license note](https://github.com/MarcoForte/FBA_Matting#models)) |
| **Background Matting V2（clean plate）** | 官方模型要求額外拍攝一張 background image，並以 input frame + clean background 做 matting；repo 提供 image/video inference、PyTorch／TorchScript／TensorFlow／ONNX，並以 RTX 2080 Ti 報告 4K 30 fps、HD 60 fps tensor throughput。([official repo](https://github.com/PeterL1n/BackgroundMattingV2), [paper](https://arxiv.org/abs/2012.07810)) | 由「同一場景的 clean background」這個額外輸入推論，因此不必只依賴外框連通；但官方論文重點是 hair-level detail，沒有提供 sticker art、文字與光效的保留證據。它只能列為值得實測的強線索，不能先宣稱會保住這些元素。clean plate、曝光與幾何也必須對齊。 | 固定鏡頭／可對齊影片尤其適合，且官方有 video inference；移動鏡頭需先做對齊，APNG 仍須檢查遮罩抖動。不是 promptable tracker。 | 官方 repo 為 MIT；官方也明確說影片編解碼腳本不是真正 production real-time，需額外工程處理硬體編解碼與平行 GPU loading。適合作為明確上傳 clean plate 的 Colab／桌面進階路徑，而不是直接假設 browser WebGPU。 |
| **Robust Video Matting（RVM）** | 官方定位是 recurrent、temporal-memory 的 **human** video matting，不需額外輸入；提供 PyTorch、ONNX、TensorFlow.js、CoreML 權重與 browser demo。([official repo](https://github.com/PeterL1n/RobustVideoMatting), [paper](https://arxiv.org/abs/2108.11515)) | 可改善真人影片的時間一致與邊緣，但 human-specific training 不等於能保留 sticker 的文字、粒子、glow 或非人類小物件；無法解決同色前景的產品意圖。 | 若輸入是人像影片，它是現成的 temporal matting baseline；對本案例的一般貼圖 Video→APNG 不應當作通用答案。 | 官方 repo 自 2021-09 起為 **GPL-3.0**；雖有 TensorFlow.js，但 GPL 與 human-only scope 都使它不適合目前產品的預設路徑。 |

### 對本案例的結論

1. **同色區域與分離元素是 selection 問題，不只是 matte 邊緣問題。** 目前最可靠的短期組合是本文件的 deterministic 邊界連通去背，加上多起點背景點、保留點／去除點與可復原的 component mask。它不需要把新模型塞入 shared core，也不會把主體同色洞誤當成全域要刪除的顏色。
2. **現有 zero-prompt 模型應定位為「候選 mask 產生器」。** IMG.LY 是 browser-local baseline；Colab Notebook 現在提供 BiRefNet、BEN2 Base、MODNet Portrait、IS-Net、U²-Net 與有條件的 RMBG 2.0 比較。釘選的 RMBG 2.0 權重受 BRIA 自訂 gated 條款約束，本 Notebook 只開放非商用評估；BEN2 只納入 Base，不等同取得商業版 full refiner。所有結果都要讓使用者看到原圖、mask、透明預覽與可修正入口，不應顯示「保證保留所有像素」。
3. **文字、speech bubble、粒子與 glow 若可在來源階段分層，應最後再合成。** 一旦語意模型把整個 glyph 或細光效變成零 alpha，後續 threshold／dilation 無法憑空重建原始像素；這也是本專案 prompt 與文件建議「把文字／泡泡在去背後再疊回」的原因。
4. **Video→APNG 短期仍沿用既有選定 frame、lazy mask cache 與最終 APNG 回讀。** 模型只處理候選格；每格顯示 mask 漂移警告與 keyframe 保留／去除修正，不把逐格語意推論說成 temporal tracking。邊界連通的 temporal propagation 可另外設計，先不要和第一版 deterministic flood fill 混在一起。

### 進階推薦（需 ADR／明確非 deterministic adapter）

- 固定鏡頭且能提供 clean plate 時，優先用本專案 fixture **評估 Background Matting V2**；它引入直接的背景差分線索，問題形式比單張語意模型更對題，但官方沒有證明它適合 sticker art、文字與光效。通過實測後，才做幾何／曝光對齊並把 alpha 丟回現有裁切、fit 與 APNG 管線。
- 沒有 clean plate 但可接受互動時，使用 **SAM 2**（較容易審核的 Apache-2.0）或在授權與 GPU 條件允許時使用 **SAM 3/3.1**：在少量 keyframe 對主體、文字、粒子、光效與小物件分別下 prompt，追蹤後 union／subtract，再把 unknown band 交給 **ViTMatte** 做 alpha refinement。這是一條「使用者意圖 → 追蹤 → 邊緣精修」的 pipeline，不是單一全自動模型。
- **RVM** 只保留給明確的人像影片實驗，且需先接受 GPL-3.0；**FBA** 需先解決 Adobe dataset 的 noncommercial 限制。兩者都不應因為 benchmark 或示範影片看起來漂亮，就成為一般 sticker art 的預設。

任何新增模型都應放在 CLI／browser adapter 或使用者自行啟動的 Colab workflow；shared `src/core/` 只接收平台中立的 RGBA／mask／alpha contract。這符合[架構邊界](../ARCHITECTURE.md)：deterministic CLI／web runtime 沒有新 provider call，新增模型、遠端 session、版本與授權需另行 ADR。瀏覽器 WebGPU 可行性只能以該模型官方或已釘選匯出的實測為準，不能因為某 repo 有 ONNX 或 Transformers.js 範例就推論所有手機都能跑。

### 目前仍不確定的部分

- 上述官方資料沒有針對本專案「近純色帶雜訊 + 背景同色字 + 粒子／glow + detached objects + Video→APNG」的共同測試集；對某個模型會不會保住某一像素的判斷，仍是需要 fixture 實測的風險，不是模型名稱可推出的結論。
- model code、weights、訓練資料與 hosted API 的授權可能不同；尤其 BiRefNet 衍生匯出、BEN/BEN2、RMBG 2.0、FBA 必須在鎖定 revision 後逐一保存 license／NOTICE，不能只看 GitHub repository badge。
- SAM 3/3.1、ViTMatte、Background Matting V2 雖有官方 Python／GPU 路徑，但目前沒有足以支撐本專案 browser WebGPU 與手機支援承諾的共同性能資料；先按 Colab／桌面進階工作流規劃。
