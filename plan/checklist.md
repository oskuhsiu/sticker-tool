# sticker-tool 進度 Checklist

> 進度追蹤專用檔。寫進度只更新這裡，不必重讀 `sticker-tool-plan.md`。
> 狀態：[ ] 未開始　[~] 進行中　[x] 完成

## M0 — Spike：驗證 codex 產圖能力
- [x] codex `image_gen` 可產圖（不需 API key）
- [x] codex 自產 4×3 sprite sheet（組圖）
- [x] codex 自切格 + 去綠幕 → RGBA 透明
- [x] 12 格 320×270、風格/角色一致、動畫連貫
- [x] 組成 APNG / GIF 成功
- [x] APNG 大小實測：12 全幀 1467KB，需減格+失真壓縮
- [x] pngquant + apngasm 真實失真壓縮實測（64色×8格=274KB✅近無損；鎖色數比高品質失真有效）

## M1 — 骨架 + core + 本機靜態主流程
- [x] npm / tsconfig / 依賴安裝（ESM + NodeNext；sharp 0.33.5 / upng-js / @imgly / commander / yaml / zod / archiver）
- [x] core: spec / types / validate / naming / grid / prompt（純邏輯，無 sharp/node 依賴）
- [x] pipeline: removeBackground / fitCanvas / processStatic（含 I-9 靜態 auto-fit、I-10#1 去背 auto 判據）
- [x] package: buildMainTab / buildZip
- [x] cli: `build <inputDir> --out --count`（含 --no-remove-bg/--stroke/--max-size/--cover）
- [x] 驗收：transparent fixtures + 去背 photos 兩路皆通；sips 獨立確認 main=240² tab=96×74 序號圖≤370×320 偶數 RGBA、zip 結構齊全
- 備註：stroke.ts（M3）、text.ts（M4 含 I-7 字型內嵌）已隨 processStatic 前置實作，待對應里程碑接 CLI/config

## M2 — AI 產圖 + 組圖 + 裁切
- [x] pipeline/codexGen（image_gen + -i + 5 道防線：輸出契約/--output-schema/驗證/temp+atomic+resume/一致性）
- [x] pipeline/cropGrid：equal / equal+rembg（detect 已砍除 per S-1）
- [x] core/grid：張數→rows×cols+sheets；角色一致性 8 支援/16 警告/24 擋下（需 forceOversizeSet）
- [x] config: schema/load（M4 提前；含 I-10#2 CLI>config>spec 與來源相依預設）
- [x] cli: `gen --config`、`prompt`（mobile）、`init`（範例設定）
- [x] 驗收：**真實 codex 跑通**——8 格角色包單次產 1536×1024 transparent sheet（首次成功），8 角色一致、切格正確、整包符合規格；--output-schema JSON 正確回傳

## M3 — 白色描邊（可開關）
- [x] pipeline/stroke（alpha blur+threshold 擴張 → 填色 → 原圖疊上）
- [x] 接進 processStatic；CLI `build --stroke` + config processing.stroke 控制
- [x] 驗收：gen/build 產出肉眼可見白色外框（見 out/airun/06.png）

## M4 — 設定檔 + 加文字
- [x] config: schema + load（YAML/JSON + zod + 預設；M2 已建）
- [x] pipeline/text（SVG 疊字；I-7：字型檔 base64 內嵌、家族名走 fc-match、缺字型報錯不靜默 fallback）
- [x] cli: `init` 產範例設定檔（examples/sticker.config.yaml）
- [x] 驗收：Latin .ttf + CJK「嗨～你好」皆正確渲染（白 halo 可讀）、缺字型正確報錯

## M5 — 動態貼圖 APNG（規格已修正：≤1MB、張數8/16/24、loops 1-4、main須APNG）
- [x] pipeline/apng（upng-js 純 JS，非 apngasm；編後改寫 acTL num_plays 設 loops 1-4）
- [x] fit：fitCanvas 'exact' 到 320×270（一邊=270、偶數）；全格同縮放同位置 → 無抖動
- [x] auto-fit 壓縮：autoLadder（colors/frames/balanced）超標才降色，回報「色×格×KB」
- [x] 設定：maxBytes/loops/durationSec/minColors/minFrames/priority/ladder（zod）
- [x] 動態包 main.png 為 APNG（buildAnimatedMain 240²）；tab 靜態；validatePack(kind=animated) 防混包
- [x] processAnimated：影格來自本機或 codex（generateFramesSheet + buildFramesPrompt）
- [x] 驗收：**本機 12 格** 8 張包全 320×270/12格×2loop/425KB、main APNG、ffprobe+UPNG 確認 num_plays=2；
      **AI 8 格**（codex waving）→ 320×270/8格×2loop/201KB，影格對齊佳

## 跨里程碑
- [x] README（正體中文，仿 ../media-dler 慣例）
- [x] mobile 共用：core/ 純淨（無 sharp/node import，已 grep 確認）、mobile 只用 prompt 層
- [x] tsup build → dist/index.js 可執行（shebang 正確、dynamic import 切 chunk OK）
- [x] examples/sticker.config.yaml（init 產生）
