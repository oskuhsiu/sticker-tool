---
name: openrouter
description: >-
  透過 openrouter.ai 的統一 API 呼叫數百個第三方模型（GPT、Gemini、Llama、DeepSeek、
  Qwen、Mistral、Grok、Sora、Veo、Seedance、Kling…），接手處理請求與回傳，並支援
  「model card」工作流：把某個模型的呼叫參數做成 card，之後一句話就能執行。當使用者
  提到 openrouter／openrouter.ai、貼出 openrouter.ai 的模型頁網址、要求建立或執行某個
  model card、想用 Anthropic 以外的模型回答問題／生成文字／看圖／生成影片，或想比較
  多個模型的回答時就用——即使他沒說出「openrouter」三個字（例：「問問 deepseek」
  「用 seedance 做個短影片」「比較幾家模型的答案」）。不適用：要 GPT 做 agentic
  寫碼任務（codex 系列 skill）、用 Gemini CLI 跑任務（gemini skill）、查 Anthropic
  自家 API 文件（claude-api skill）。
---

# OpenRouter 轉接器

兩個零依賴引擎，按場景選：

| 引擎 | 場景 |
|---|---|
| `scripts/openrouter.mjs`（Node ≥ 20） | 一次性對話／看圖／搜模型——不值得建 card 的輕量請求 |
| `scripts/card.py`（python3） | **model card 工作流**：把模型參數快照成 card、之後反覆執行；影片生成一律走這裡 |

兩者共通：**成果走 stdout**（回覆正文、檔案路徑），**進度與用量摘要走 stderr**
（含實際路由到的模型與費用）——你只要組好指令、讀回 stdout 用進對話即可。

```bash
node <此skill目錄>/scripts/openrouter.mjs chat -m deepseek/deepseek-chat -p "..."
```

## 前置：API key（只需設定一次）

來源優先序：env `OPENROUTER_API_KEY` → 專案 `.claude/openrouter.key`（**已
gitignore，絕不進版控**）→ `~/.config/openrouter/key`。沒 key 時 chat 會明確報錯。
先跑 `check` 診斷；真的沒有就引導使用者：到 https://openrouter.ai/settings/keys
建 key，存進上述任一處（檔案記得 chmod 600）。
**任何情況都不要把 key 內容印出來或寫進對話。**

## 子指令速查

| 指令 | 用途 | 需要 key |
|---|---|---|
| `chat` | 送對話請求（文字＋圖片輸入） | ✅ |
| `models [關鍵字]` | 搜模型 id、context 長度、每百萬 token 價格 | ❌ |
| `check` | 診斷 key 來源／連線／餘額 | ❌（有 key 多顯示額度） |

## 呼叫模式

- **短提示**：`chat -m <id> -p "問題"`。
- **長提示或含引號／程式碼**：先寫進 `/tmp/or-prompt.txt`，再 `-f /tmp/or-prompt.txt`
  ——跟本專案 codex 慣例相同，避免 shell 引號地獄。
- **看圖**：`-i 圖.png`（可重複多張）。
- **結果要給後續步驟用**：`-o 檔案` 另存正文；要原始 JSON（含 reasoning、完整
  usage）加 `--json`。
- **結構化輸出**：`--json-schema schema.json`；schema 寫法見 `references/api.md`。

## Model card 工作流（card.py）

card＝某個模型的呼叫設定快照（JSON，存在本 skill 的 `cards/`），內含能力清單
（支援的時長／尺寸／參數）、計價、與你設定的預設值。**使用者貼模型頁網址或說
「建立 XX 的 card」→ create；說「用 XX card 做…」→ run。**

```bash
python3 <此skill目錄>/scripts/card.py create https://openrouter.ai/bytedance/seedance-2.0-fast --alias seedance
python3 <此skill目錄>/scripts/card.py list
python3 <此skill目錄>/scripts/card.py run seedance -p "角色跳草裙舞" --ref char.png --ref pose.png --duration 4 --out-dir spike
```

- `create` 不需 key（公開端點）；自動判別 kind：影片模型（在 `/videos/models`
  目錄者）→ `video`，其餘 → `chat`。`--default k=v` 可存常用預設。
- `run` 一律先讀 card 再組請求：**參數會對著 card 的能力清單驗證**——時長不支援
  時自動取最接近值並警告（例：要 3 秒但模型最短 4 秒→用 4 秒，務必轉述給使用者）、
  尺寸不在清單直接擋下。
- **影片是非同步 job**：submit → 每 15s poll → 完成自動下載 mp4，stdout 印檔案路徑。
  預設最多等 15 分鐘；要先收手用 `--no-wait` 拿 job id，之後
  `card.py job <alias> --id <jobid>` 續抓。
- 影片圖片輸入兩種模式：`--ref`（reference-to-video，風格／角色參考）、
  `--first-frame`／`--last-frame`（image-to-video，指定首尾幀）。兩者並存時 API
  以 frame_images 為準。本地圖檔會自動轉 base64 data URL；官方文件只示範公開
  HTTPS URL——若被 4xx 拒絕，把圖丟到可公開存取的網址再試。
- **有動作參照圖時，prompt 不要自行描述動作**（實測教訓：自己腦補的招式描述會
  把模型帶離參照圖，產出全錯）。只寫指向句「動作依照參考圖」即可；沒有參照圖
  才視情況用文字描述動作。使用者明確給了動作描述則照用。
- **供應商對真人照片的審查差異很大，先按需求選模型**：
  - **Seedance／ByteDance 擋真人**：reference/frame 圖疑似真人就回
    `InputImageSensitiveContentDetected.PrivacyInformation`（submit 失敗不扣款）。
    只吃 AI 生成人像、插畫、3D、側臉。要用它就改餵卡通／插畫 master（可先用
    char-gen 做）＋文字鎖角色特徵。
  - **Kling／Kuaishou 對真人 i2v 寬容**（實測 `kling-v3.0-std` 真人幼兒照直接過）：
    要保住「真人寫實」形象，用 kling 的 `--first-frame` 餵真人照當起始幀讓他動
    起來。代價：kling 走 image-to-video，吃不了卡通動作分解圖（風格與機制都不合），
    動作只能靠文字描述。
  - 一句話：**要寫實真人→kling first_frame；要掛卡通動作分解圖→seedance＋插畫 master。**
- **執行影片 job 的 Bash 呼叫記得把 timeout 拉到 600000ms**，或用 `--no-wait` 分段。
- 影片有費用：跑之前用 card 裡的 `pricing_skus` 粗估並告知使用者（seedance 類
  `video_tokens` 計價約＝寬×高×秒×24fps÷1024×單價；720p 4 秒約 $0.5 量級）。

## 模型選擇

- 不指定 `-m` 時用 `openrouter/auto`（OpenRouter 自動路由，永遠有效）。
- **不要憑記憶硬寫模型 id**——id 常改版、下架。先 `models <關鍵字>` 搜出正確 id
  與現價再用；使用者只說廠牌（如「用 qwen」）時，挑搜尋結果中該家最新的旗艦或
  使用者指明的等級。
- 比較多模型：同一個 prompt 檔分次 `-f` 給不同 `-m`，把各家回答整理對照。

## 回傳與錯誤

stdout＝模型回覆正文；stderr＝`[openrouter] model=… in=… out=… cost=$… 秒數`。
把 stderr 的實際模型與費用轉述給使用者（auto 路由時尤其重要）。

| 錯誤 | 含義與下一步 |
|---|---|
| 401 | key 無效／未設定 → 走「前置」引導 |
| 402 | 餘額不足 → 請使用者到 openrouter.ai 儲值 |
| 404 | 模型 id 錯或已下架 → `models` 重搜 |
| 429 | 限流 → 腳本已自動重試一次；仍失敗就換模型或稍候 |
| 逾時 | 預設 120s → `--timeout` 放寬或換快模型 |

## 費用意識

單次呼叫通常不到一美分，但**迴圈、批次、多模型比較會累積**：要發超過十次呼叫或
用明顯昂貴的模型（搜尋結果價格欄一看便知）前，先把預估量級告訴使用者再動手。

## 進階

reasoning effort、`:online` 聯網、provider 路由、`--extra` 逃生門、模型回傳圖片的
存檔行為等，見 `references/api.md`。
