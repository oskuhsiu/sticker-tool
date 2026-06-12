# 動作庫調查（OpenPose 骨架／姿勢參照／mocap）

> 調查日期：2026-06-11。用途：作為 char-gen 產圖時的姿勢參照來源，
> 涵蓋靜態貼圖（單張姿勢）與動態貼圖（連續影格）。
> LINE 貼圖屬商用，每項都標注授權。

## TL;DR 推薦

- **靜態首選**：[Pose Depot](https://github.com/a-lgil/pose-depot)（Apache 2.0，OpenPose＋depth＋canny＋normal 四格式齊全）＋ Civitai 的 [3367 姿勢大包](https://civitai.com/models/356701/openpose-sfw-pose-package-total-3367-poses)
- **動態首選**：Civitai 上現成的 **OpenPose 連續影格包**（走路／跑步 8 方向、跳躍、深蹲，直接是影格序列，最貼合動態貼圖需求）；要更大量就用 **Mixamo** 或 **CMU mocap** 再轉成骨架影格
- **要避開**：Bandai Namco 動作庫品質很好但 **CC BY-NC-ND（禁商用）**，做要上架的貼圖不能用

## 一、靜態姿勢庫（單張 OpenPose 骨架）

| 資源 | 內容 | 格式 | 授權 |
|---|---|---|---|
| [Pose Depot](https://github.com/a-lgil/pose-depot) | 多姿勢、多角度，有[網頁圖庫](https://a-lgil.github.io/pose-depot/gallery/)可按標籤篩選，從 Releases 下載 | OpenPose／Depth／Canny／Normal 四套 | Apache 2.0（可商用） |
| [OpenPoses.com](https://openposes.com/) | OpenPose 骨架圖集 | 骨架 PNG | 明示任何專案（含商用）皆可免費使用 |
| [OpenPoses Collection（Civitai）](https://civitai.com/models/22214/openposes-collection) | 同上，Civitai 鏡像版 | 骨架 PNG | 免費含商用 |
| [OpenPose SFW 大包（Civitai）](https://civitai.com/models/356701/openpose-sfw-pose-package-total-3367-poses) | **共 3,367 個姿勢**，目前找到量最大的單一包 | 骨架 PNG | 依 Civitai 頁面標示 |
| [Dynamic Poses](https://civitai.com/models/132155/dynamic-poses)、[Poses Packs Collection](https://civitai.com/models/76882/poses-packs-collection)、[50 Glamour Poses](https://civitai.com/models/326661/50-glamour-poses-openpose) | 動感姿勢、肖像、雜項小包 | 骨架 PNG，部分附 OpenPose Editor 可編輯格式 | 各頁面標示 |
| [raulc0399/open_pose_controlnet（Hugging Face）](https://huggingface.co/datasets/raulc0399/open_pose_controlnet) | 2 萬筆「真實照片＋對應 openpose 圖」資料集 | parquet（圖像對） | 研究訓練向 |
| [Posemaniacs](https://www.posemaniacs.com/en) | 大量 3D 人體姿勢，可任意旋轉視角後截圖 | 3D 檢視器（非 openpose，但可當參照圖） | Royalty-free，明示可商用、可用於 AI img2img |
| [PoseMy.Art](https://posemy.art/) | 線上 3D 擺姿工具，內建姿勢庫，**有 chibi（Q版）模型**——對貼圖特別有用 | 可匯出 OpenPose／Depth／Canny 圖 | 免費版可用 |

## 二、動態動作庫（連續影格／mocap 序列）

### 直接可用的 OpenPose 影格序列（最省事）

- [走路＋跑步動畫姿勢，8 方向（Civitai）](https://civitai.com/models/56307/character-walking-and-running-animation-poses-8-directions)：4 種動畫（一般跑／一般走／少女跑／女性走）× 8 個方向，**每方向 50–80 張影格**，挑幾張就能組動態貼圖
- [跑步動畫影格 OpenPose/DWPose（Civitai）](https://civitai.com/models/162947/open-pose-dwpose-running-animation-figures)
- [跳躍（Civitai）](https://civitai.com/models/132242/openpose-jumping)、[跑步（Civitai）](https://civitai.com/models/138955/openpose-running)、[深蹲動畫（Civitai）](https://civitai.com/models/352590/open-pose-dwpose-squatting-animation)

### 大型 mocap 動作庫（量大，需轉換）

| 資源 | 規模 | 格式 | 授權 |
|---|---|---|---|
| [Mixamo（Adobe）](https://www.mixamo.com) | 約 2,500 個動作（走跑跳、揮手、跳舞、打鬥、情緒動作），自動綁骨 | FBX | Adobe 帳號免費，可商用 |
| [CMU Motion Capture Database](https://mocap.cs.cmu.edu/) | 2,500+ 段、144 位受試者 | BVH／FBX（[FBX 版在 Hugging Face](https://huggingface.co/datasets/gbionics/cmu-fbx)） | **Public domain**，最乾淨 |
| [Bandai Namco Research Motiondataset](https://github.com/BandaiNamcoResearchInc/Bandai-Namco-Research-Motiondataset) | 3,000+ 動作，含日常、打鬥、跳舞，且有「疲倦／開心」等**風格變化** | BVH | ⚠️ **CC BY-NC-ND，禁商用**——做上架貼圖不可用 |
| [AMASS](https://files.is.tue.mpg.de/black/papers/amass.pdf)／[AIST++](https://github.com/google/aistplusplus_api) | AMASS 整合 15 個 mocap 庫；AIST++ 有 1,408 段舞蹈動作 | SMPL 參數 | 需註冊，研究授權為主 |

### mocap → OpenPose 的轉換工具

- [io7m 的 OpenPose rig for Blender](https://github.com/io7m/com.io7m.visual.openpose_rig)：在 Blender 裡套上會「長得像 openpose 骨架」的模型，把 Mixamo/CMU 動作 retarget 上去後逐格 render，就得到 openpose 影格序列
- toyxyz 的 **OpenPoseBone**（Gumroad 免費）：同類工具，常配 ComfyUI 用（[教學影片](https://www.youtube.com/watch?v=L3hVYeMWIqA)）
- [open-pose-editor](https://github.com/ZhUyU1997/open-pose-editor)：線上 3D openpose 編輯器，手動微調單格姿勢（含手部）

## 三、貼圖向補充（Q版／表情）

- [PoseMy.Art 的 chibi 姿勢庫](https://posemy.art/chibi-poses/)：Q 版比例的現成姿勢，最接近 LINE 貼圖的頭身比
- [Anime Reference Poses](https://animereferenceposes.com/)：動漫向姿勢參照（chibi、雙人、動態）
- Civitai 上有 [123 個 emoji/貼圖類模型與素材](https://civitai.com/tag/emoji)可挖

## 接到 sticker-tool 流水線的建議

- **靜態貼圖**：直接從 Pose Depot／OpenPoses 挑骨架圖當 char-gen 的姿勢參照。
- **動態貼圖**：優先用 Civitai 那幾包現成影格序列（已經是 8–80 格的 PNG，抽 5–20 格正好符合 APNG 規格），不夠的動作再用 Mixamo + Blender openpose rig 自己 render。
- **授權**：CMU（public domain）、Pose Depot（Apache 2.0）、Mixamo、OpenPoses 都安全；唯獨 Bandai Namco 要避開。
- **待驗證**：char-gen 走的是 codex image_gen（文生圖＋參照圖），不是 ControlNet，openpose 骨架圖是當「姿勢描述參照」附給模型，控制力會比 ControlNet 弱——建議先拿 2–3 張骨架圖實測 image_gen 是否會乖乖跟姿勢，再決定要不要大量下載。

## 附註

- OpenPose **函式庫本身**（CMU-Perceptual-Computing-Lab/openpose）商用要年費 USD 25,000，但這只限制「跑該軟體做姿勢偵測」；上述姿勢圖集是獨立資源，授權各自獨立，不受影響。
