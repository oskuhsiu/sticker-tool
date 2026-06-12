# OpenRouter API 進階參考

## 影片生成 API（card.py 的 video 卡在用）

非同步 job 流程（與 chat/completions 完全不同的端點）：

| 步驟 | 端點 |
|---|---|
| 模型目錄＋能力 | `GET /videos/models`（公開；supported_sizes/durations、pricing_skus、passthrough 清單） |
| 送出 | `POST /videos` `{model, prompt, duration, size 或 resolution+aspect_ratio, frame_images, input_references, generate_audio, seed, provider}` → 202 `{id, polling_url, status}` |
| 輪詢 | `GET /videos/{id}` → status：pending → in_progress → completed／failed／cancelled／expired |
| 下載 | completed 後 `unsigned_urls[]`（即 `GET /videos/{id}/content?index=0`），`usage.cost` 是實際扣款 |

- `frame_images`：`[{type:"image_url", image_url:{url}, frame_type:"first_frame"|"last_frame"}]`
  （image-to-video）；`input_references`：`[{type:"image_url", image_url:{url}}]`
  （reference-to-video，另支援 audio_url/video_url）。兩者並存以 frame_images 為準。
- 文件示範皆為公開 HTTPS URL；data URL 未明文保證，被 4xx 拒時改丟圖床。
- 生成通常 30 秒～數分鐘；官方建議輪詢間隔別太密。
- 影片生成不適用 ZDR（零資料保留）——產出會在供應商端短暫保留以供下載。
- 計價：`pricing_skus` 依模型而異（per-video-second 或 video_tokens）。video_tokens
  估算式約＝寬×高×秒數×24÷1024×單價。
- 完整文件：https://openrouter.ai/docs/guides/overview/multimodal/video-generation.md
  （任何 docs 頁面網址加 `.md` 即得乾淨 Markdown；索引在 /docs/llms.txt）

`openrouter.mjs` 蓋住日常八成用法；這裡是其餘兩成。OpenRouter 的 API 與 OpenAI
chat/completions 相容，端點 `https://openrouter.ai/api/v1`。官方文件：
https://openrouter.ai/docs

## chat 參數對照

| 旗標 | 對應 request 欄位 | 備註 |
|---|---|---|
| `-m/--model` | `model` | 預設 `openrouter/auto`（自動路由） |
| `-s/--system` | `messages[0].role=system` | |
| `--temperature` | `temperature` | 0–2 |
| `--max-tokens` | `max_tokens` | 回覆被截斷（stderr 顯示 `finish=length!`）時調高 |
| `--effort` | `reasoning.effort` | `low/medium/high`，僅推理模型有感 |
| `--json-schema <file>` | `response_format.json_schema` | 見下節 |
| `--online` | 模型 id 加 `:online` 後綴 | OpenRouter 代為網路搜尋再回答 |
| `--extra '<json>'` | 直接 merge 進 body | 逃生門，見下 |

## structured outputs（--json-schema）

檔案內容是 `json_schema` 物件本身（不是整個 response_format）：

```json
{
  "name": "extraction",
  "strict": true,
  "schema": {
    "type": "object",
    "properties": { "title": { "type": "string" }, "tags": { "type": "array", "items": { "type": "string" } } },
    "required": ["title", "tags"],
    "additionalProperties": false
  }
}
```

並非所有模型都支援；不支援時 OpenRouter 回 4xx，換模型（OpenAI/Gemini 家族支援度最好）。

## --extra 逃生門（任何沒做成旗標的參數）

```bash
--extra '{"provider":{"order":["openai","together"],"allow_fallbacks":false}}'   # 指定供應商順序
--extra '{"models":["anthropic/claude-sonnet-4-6","openai/gpt-5.1"]}'            # 候選模型列表（依序 fallback）
--extra '{"plugins":[{"id":"web","max_results":3}]}'                             # 網搜外掛細部控制
--extra '{"top_p":0.9,"frequency_penalty":0.5}'                                  # 任何取樣參數
```

## 模型 id 慣例

- 格式 `vendor/model-name`，例：`openai/gpt-5.1`、`google/gemini-2.5-flash`、
  `deepseek/deepseek-chat-v3.1`、`meta-llama/llama-4-maverick`。
- 後綴變體：`:free`（免費額度池、嚴格限流）、`:nitro`（最快供應商）、`:online`（聯網）。
- id 與價格都會變動，**用 `models` 子指令現查**，別信記憶或本檔案的舉例。

## 回應裡的特殊欄位

- `usage.cost`：本次實際扣款（USD）。腳本已要求 `usage:{include:true}` 並印在 stderr。
- `message.reasoning`：推理模型的思考過程。預設不印（只在 `--json` 出現）。
- `message.images[]`：圖像生成模型（如 `google/gemini-2.5-flash-image`）的 base64
  輸出。腳本會自動存成 `./openrouter-image-N.png` 並在 stderr 提示。
- `model`（頂層）：實際路由到的模型——`openrouter/auto` 時務必轉述給使用者。

## key 管理端點

- `GET /key`（`check` 子指令在用）：回 label、累計 usage、limit，不會回 key 本身。
- key 永遠只放 env 或 `~/.config/openrouter/key`，不進 git、不進對話、不進腳本。
