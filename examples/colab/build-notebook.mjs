import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const output = process.env.STICKER_TOOL_NOTEBOOK_OUTPUT
  ? resolve(process.env.STICKER_TOOL_NOTEBOOK_OUTPUT)
  : fileURLToPath(new URL('./sticker-tool-birefnet-colab.ipynb', import.meta.url));

function lines(source) {
  const normalized = source.replace(/\r\n/g, '\n');
  const parts = normalized.split('\n');
  return parts.map((line, index) => index < parts.length - 1 ? `${line}\n` : line);
}

function markdown(source) {
  return { cell_type: 'markdown', metadata: {}, source: lines(source) };
}

function code(source) {
  return {
    cell_type: 'code',
    execution_count: null,
    metadata: {},
    outputs: [],
    source: lines(source),
  };
}

const notebook = {
  cells: [
    markdown(`# sticker-tool · Colab 多模型去背

這個 Notebook 會在你自己的 Google Colab runtime 中，一次載入一個去背模型；先以 scikit-image 內建的 astronaut 圖量測，再視需要啟動臨時 HTTPS API。

重要限制：

- 所有選項都是視覺分割／matting 模型，不是 LLM，也不理解「文字一定要保留」。文字、emoji、光暈、粒子或與角色分離的小物仍可能被判成背景。
- 免費 Colab 不保證 runtime 時數或 T4 可用性；停止、斷線或刪除 runtime 後，臨時 URL 與 session key 都會失效。
- 同一時間只會有一個模型佔用 GPU。切換時不用 Disconnect T4：先停止最後一格、改 MODEL_CHOICE，再 Run all。
- Run all 會重建 API 與 tunnel，因此要把新的 endpoint URL 和 session key 貼回 sticker-tool；不要在正在處理一批圖片時切換。
- 已下載權重與 pip 套件會留在同一台 Colab VM 的磁碟快取；刪除 runtime 才會清掉。

先看 benchmark 與遮罩品質；不滿意就停在那裡換模型，不必啟動 API。`),

    markdown(`## 1. 選擇模型與運算裝置

建議從 **birefnet-lite + auto + 512** 開始。

| 選項 | 適合情況 | 主要限制 |
| --- | --- | --- |
| birefnet-lite | 通用、速度與品質折衷，推薦起點 | 可能漏掉分離文字、小 emoji、粒子與光暈 |
| birefnet-full | 通用、較重視細節 | 0.2B、固定方形輸入，較慢且較吃 VRAM |
| birefnet-dynamic | 非正方形 crop、保留長寬比 | 0.2B，較慢且仍不是文字感知模型 |
| birefnet-lite-matting | 細邊、頭髮、半透明邊緣的輕量比較 | matting 訓練偏人物；可能排除分離裝飾 |
| birefnet-matting | 固定 1024 的完整 matting 比較 | 0.2B、較吃 VRAM；訓練資料偏人物 |
| birefnet-dynamic-matting | 非正方形與細緻 alpha | 0.2B，T4 負擔最高的一組選項之一 |
| ben2-base | 通用物件、細緻邊緣的另一種模型 | 內部 1024；分離文字／特效仍可能消失 |
| modnet-portrait | 快速人物 alpha matting | **只適合人物**，不適合一般角色／物件貼圖 |
| isnet-general | ONNX 通用顯著物件分割 | 不是精細 alpha matting，透明特效較弱 |
| isnet-anime | 動漫／插畫素材比較 | 不保證保留文字、emoji 或同色小物 |
| u2net | 傳統顯著物件基準 | 邊緣與半透明細節通常較粗 |
| u2netp | 最輕量的傳統基準 | 速度優先，細節通常最少 |
| rmbg-2.0 | BRIA 的通用去背模型 | gated、自訂授權；此 Notebook 只開放非商用評估，並需 HF_TOKEN |

SAM 2/3 需要點、框或文字 prompt；ViTMatte/FBA 需要 trimap；Background Matting V2 需要乾淨背景；RVM 需要連續人物影片狀態。它們不是目前「單張 PNG → 一張 alpha mask」契約的直接替代，因此不放進這個一鍵選單。`),

    code(`# @title 多模型去背設定
MODEL_CHOICE = "birefnet-lite" # @param ["birefnet-lite", "birefnet-full", "birefnet-dynamic", "birefnet-lite-matting", "birefnet-matting", "birefnet-dynamic-matting", "ben2-base", "modnet-portrait", "isnet-general", "isnet-anime", "u2net", "u2netp", "rmbg-2.0"]
DEVICE_CHOICE = "auto" # @param ["auto", "gpu", "cpu"]
INPUT_SIZE = 512 # @param [512, 1024] {type:"raw"}
BENCHMARK_RUNS = 1 # @param [1, 3] {type:"raw"}
ALLOW_NONCOMMERCIAL_RMBG = False # @param {type:"boolean"}

MODEL_OPTIONS = {
    "birefnet-lite": {
        "label": "BiRefNet Lite（推薦起點）",
        "engine": "birefnet",
        "id": "ZhengPeng7/BiRefNet_lite",
        "revision": "7838f1c3472f827cd8ce13ab5ccc2ce48077360f",
        "input_mode": "fixed",
        "traits": "通用、44.4M，速度與品質折衷；先用它建立比較基準。",
        "license": "MIT（模型卡）",
    },
    "birefnet-full": {
        "label": "BiRefNet Full",
        "engine": "birefnet",
        "id": "ZhengPeng7/BiRefNet",
        "revision": "b7d7f31fed203ab364ac756d62053ee467502434",
        "input_mode": "fixed",
        "traits": "通用 0.2B；通常比 lite 細，但固定方形輸入、較慢且較吃 VRAM。",
        "license": "MIT（模型卡）",
    },
    "birefnet-dynamic": {
        "label": "BiRefNet Dynamic",
        "engine": "birefnet",
        "id": "ZhengPeng7/BiRefNet_dynamic",
        "revision": "280306042f57b7a33854319da62fd86aaa89ec4c",
        "input_mode": "dynamic",
        "traits": "通用 0.2B；保留來源長寬比，適合非正方形 crop。",
        "license": "MIT（模型卡）",
    },
    "birefnet-lite-matting": {
        "label": "BiRefNet Lite Matting",
        "engine": "birefnet",
        "id": "ZhengPeng7/BiRefNet_lite-matting",
        "revision": "99c33412e3f58e1f33187abdc8c435c645243690",
        "input_mode": "fixed",
        "traits": "輕量 matting；適合比較髮絲與半透明細邊，但訓練資料偏人物。",
        "license": "MIT（模型卡）",
    },
    "birefnet-matting": {
        "label": "BiRefNet Full Matting",
        "engine": "birefnet",
        "id": "ZhengPeng7/BiRefNet-matting",
        "revision": "57f9f68b43ba337c75762b14cf3075d659007268",
        "input_mode": "fixed-1024",
        "traits": "完整 0.2B、固定 1024 的通用 matting；適合和 lite／dynamic matting 比較。",
        "license": "MIT（模型卡）",
    },
    "birefnet-dynamic-matting": {
        "label": "BiRefNet Dynamic Matting",
        "engine": "birefnet",
        "id": "ZhengPeng7/BiRefNet_dynamic-matting",
        "revision": "074df545be87034e74a96bf71566ecbbc4c15f0a",
        "input_mode": "dynamic",
        "traits": "0.2B、保留長寬比的 matting；細 alpha 比較用，速度與 VRAM 成本高。",
        "license": "MIT（模型卡）",
    },
    "ben2-base": {
        "label": "BEN2 Base",
        "engine": "ben2",
        "id": "PramaLLC/BEN2",
        "revision": "e48a20765fb421d19dcdb0bf3cc61e802ca5ec8f",
        "input_mode": "internal-1024",
        "traits": "94.6M 的物件分割／matting 比較；內部使用 1024×1024。",
        "license": "MIT（Base 模型；不含商業版 full model）",
    },
    "modnet-portrait": {
        "label": "MODNet Portrait（人物專用）",
        "engine": "modnet",
        "id": "Xenova/modnet",
        "revision": "fa2fa546052fba4c08921230a26cc69a333fca12",
        "model_file": "onnx/model.onnx",
        "input_mode": "portrait-dynamic",
        "traits": "快速 trimap-free 人物 matting；只應用於真人肖像，不是通用角色／物件模型。",
        "license": "Apache-2.0（MODNet；ONNX conversion repository）",
    },
    "isnet-general": {
        "label": "IS-Net General（ONNX）",
        "engine": "rembg",
        "id": "isnet-general-use",
        "revision": "rembg-2.0.67-checksummed",
        "input_mode": "internal-1024",
        "traits": "通用顯著物件分割；可當不同架構基準，但不是精細 alpha matting。",
        "license": "Apache-2.0（IS-Net code/model；由 rembg adapter 載入）",
    },
    "isnet-anime": {
        "label": "IS-Net Anime（ONNX）",
        "engine": "rembg",
        "id": "isnet-anime",
        "revision": "rembg-2.0.67-checksummed",
        "input_mode": "internal-1024",
        "traits": "針對動漫／插畫的顯著物件版本；適合和通用模型做 A/B。",
        "license": "Apache-2.0（IS-Net code/model；由 rembg adapter 載入）",
    },
    "u2net": {
        "label": "U²-Net（ONNX 傳統基準）",
        "engine": "rembg",
        "id": "u2net",
        "revision": "rembg-2.0.67-checksummed",
        "input_mode": "internal-320",
        "traits": "成熟的顯著物件基準；通常比新模型粗，但方便辨識模型偏差。",
        "license": "Apache-2.0（U²-Net repo；由 rembg adapter 載入）",
    },
    "u2netp": {
        "label": "U²-NetP（ONNX 輕量基準）",
        "engine": "rembg",
        "id": "u2netp",
        "revision": "rembg-2.0.67-checksummed",
        "input_mode": "internal-320",
        "traits": "最輕量、速度優先；細節與半透明邊緣通常最少。",
        "license": "Apache-2.0（U²-Net repo；由 rembg adapter 載入）",
    },
    "rmbg-2.0": {
        "label": "BRIA RMBG 2.0（自訂授權、gated）",
        "engine": "birefnet",
        "id": "briaai/RMBG-2.0",
        "revision": "8466043b7b29ea0e0d1f4cc95b2bca1f5fcf8ae0",
        "input_mode": "fixed-1024",
        "traits": "BRIA 的 0.2B 通用背景去除模型；只在你已接受官方 gated 條款後測試。",
        "license": "釘選 revision 標示 BRIA 自訂 bria-rmbg-2.0 授權；此 Notebook 僅開放非商用評估，商用權利需另行確認",
        "requires_hf_token": True,
        "noncommercial": True,
    },
}

if MODEL_CHOICE not in MODEL_OPTIONS:
    raise ValueError(f"Unknown MODEL_CHOICE: {MODEL_CHOICE}")
if DEVICE_CHOICE not in {"auto", "gpu", "cpu"}:
    raise ValueError("DEVICE_CHOICE must be auto, gpu, or cpu")
if INPUT_SIZE not in {512, 1024}:
    raise ValueError("INPUT_SIZE must be 512 or 1024")
if BENCHMARK_RUNS not in {1, 3}:
    raise ValueError("BENCHMARK_RUNS must be 1 or 3")

SELECTED_MODEL = MODEL_OPTIONS[MODEL_CHOICE]
if SELECTED_MODEL.get("noncommercial") and not ALLOW_NONCOMMERCIAL_RMBG:
    raise RuntimeError("此 Notebook 只開放 RMBG 2.0 非商用評估。請閱讀釘選 revision 的 BRIA 自訂授權並確認用途，再勾選 ALLOW_NONCOMMERCIAL_RMBG。")

print("Selected:", MODEL_CHOICE, "·", SELECTED_MODEL["label"])
print("特性:", SELECTED_MODEL["traits"])
print("授權:", SELECTED_MODEL["license"])
print("提醒：所有模型都不保證保留文字、emoji、光暈、粒子或分離小物；請逐種素材實測。")
print("Device:", DEVICE_CHOICE, "· input setting:", INPUT_SIZE, "· benchmark runs:", BENCHMARK_RUNS)`),

    code(`# @title 安裝一次性的相容環境（同一 runtime 重跑會使用 pip／模型快取）
# 先固定共享相依，再以 --no-deps 安裝兩個 adapter，避免它們在切換時改動 Torch。
%pip uninstall -q -y google-adk gradio python-fasthtml
%pip install -q "numpy==2.0.2" "pillow==11.3.0" "scipy==1.15.3" "scikit-image==0.25.2" "opencv-python-headless==4.12.0.88" "pooch==1.8.2" "pymatting==1.1.14" "jsonschema==4.25.1" "tqdm==4.67.1" "onnxruntime-gpu==1.22.0" "transformers==4.48.3" "huggingface-hub==0.28.1" "timm==1.0.15" "kornia==0.7.4" "einops==0.8.0" "accelerate==1.2.1" "fastapi==0.115.6" "uvicorn==0.34.0" "python-multipart==0.0.20"
%pip install -q --no-deps "rembg==2.0.67" "git+https://github.com/PramaLLC/BEN2.git@2c99a5da477b5523585bfa5c893888a6e818a8f6"
%pip check`),

    markdown(`## 2. 載入選定模型

這格會先停止上一輪 tunnel 與 Uvicorn，再卸載上一個 Torch／ONNX model、同步 CUDA、執行 garbage collection 與清空 allocator cache，最後只載入目前選定的模型。

第一次選某個模型會下載固定 revision 或由 rembg checksum 驗證的權重；切回同一模型會重用同一台 VM 的磁碟快取。RMBG 2.0 另需先在 Hugging Face 接受 gated 條款，並把 token 放進 **Colab Secrets → HF_TOKEN**；Notebook 不會印出 token。`),

    code(`# @title 停止上一輪服務、卸載舊模型、載入目前選項
import gc
import os
import time

import torch
from PIL import Image
from torchvision import transforms
from transformers import AutoModelForImageSegmentation

def stop_previous_services():
    previous_tunnel = globals().get("tunnel_process")
    if previous_tunnel is not None and previous_tunnel.poll() is None:
        previous_tunnel.terminate()
        try:
            previous_tunnel.wait(timeout=10)
        except Exception:
            previous_tunnel.kill()
            previous_tunnel.wait(timeout=5)
    previous_server = globals().get("api_server")
    if previous_server is not None:
        previous_server.should_exit = True
    previous_thread = globals().get("server_thread")
    if previous_thread is not None and previous_thread.is_alive():
        previous_thread.join(timeout=10)
        if previous_thread.is_alive():
            raise RuntimeError("上一輪 Uvicorn 尚未停止；請再按一次停止後重跑此格。")

def unload_previous_model():
    previous = globals().get("ACTIVE_MODEL")
    if previous is not None:
        try:
            if hasattr(previous, "to"):
                previous.to("cpu")
        except Exception:
            pass
    globals()["ACTIVE_MODEL"] = None
    globals()["LOADED_MODEL_STATE"] = None
    del previous
    gc.collect()
    if torch.cuda.is_available():
        torch.cuda.synchronize()
        torch.cuda.empty_cache()

stop_previous_services()
unload_previous_model()

if DEVICE_CHOICE == "gpu" and not torch.cuda.is_available():
    raise RuntimeError("你選了 gpu，但這個 Colab runtime 沒有 CUDA。請改 auto/cpu，或到 Runtime → Change runtime type 選 GPU。")

MODEL_ENGINE = SELECTED_MODEL["engine"]
MODEL_ID = SELECTED_MODEL["id"]
MODEL_REVISION = SELECTED_MODEL["revision"]
MODEL_INPUT_MODE = SELECTED_MODEL["input_mode"]
TORCH_DEVICE = "cuda" if DEVICE_CHOICE in {"auto", "gpu"} and torch.cuda.is_available() else "cpu"
MODEL_INPUT_LABEL = (
    f"source aspect, max edge {INPUT_SIZE}, /32" if MODEL_INPUT_MODE == "dynamic"
    else "source aspect, shortest 512, max 1024, /32" if MODEL_INPUT_MODE == "portrait-dynamic"
    else "1024×1024 (model fixed)" if MODEL_INPUT_MODE in {"fixed-1024", "internal-1024"}
    else "320×320 (model internal)" if MODEL_INPUT_MODE == "internal-320"
    else f"{INPUT_SIZE}×{INPUT_SIZE}"
)

HF_TOKEN = None
if SELECTED_MODEL.get("requires_hf_token"):
    try:
        from google.colab import userdata
        HF_TOKEN = userdata.get("HF_TOKEN")
    except Exception:
        HF_TOKEN = os.environ.get("HF_TOKEN")
    if not HF_TOKEN:
        raise RuntimeError("請先接受 briaai/RMBG-2.0 的 gated 條款，再於 Colab Secrets 新增 HF_TOKEN。")

tensor_transform = transforms.Compose([
    transforms.ToTensor(),
    transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
])

load_started = time.perf_counter()
ACTIVE_MODEL = None
ACTUAL_DEVICE = TORCH_DEVICE

def choose_ort_providers():
    import onnxruntime as ort
    available = ort.get_available_providers()
    if DEVICE_CHOICE == "gpu" and "CUDAExecutionProvider" not in available:
        raise RuntimeError(f"onnxruntime 沒有 CUDAExecutionProvider；available={available}")
    if DEVICE_CHOICE == "cpu":
        return ["CPUExecutionProvider"]
    if DEVICE_CHOICE == "gpu":
        return ["CUDAExecutionProvider"]
    return ["CUDAExecutionProvider", "CPUExecutionProvider"] if "CUDAExecutionProvider" in available else ["CPUExecutionProvider"]

if MODEL_ENGINE == "birefnet":
    ACTIVE_MODEL = AutoModelForImageSegmentation.from_pretrained(
        MODEL_ID,
        revision=MODEL_REVISION,
        trust_remote_code=True,
        token=HF_TOKEN,
    ).to(TORCH_DEVICE).eval()
    if TORCH_DEVICE == "cuda":
        torch.set_float32_matmul_precision("high")
        ACTIVE_MODEL = ACTIVE_MODEL.half()
elif MODEL_ENGINE == "ben2":
    from ben2 import BEN_Base
    ACTIVE_MODEL = BEN_Base.from_pretrained(
        MODEL_ID,
        revision=MODEL_REVISION,
    ).to(TORCH_DEVICE).eval()
    if TORCH_DEVICE == "cuda":
        ACTIVE_MODEL = ACTIVE_MODEL.half()
elif MODEL_ENGINE == "modnet":
    import onnxruntime as ort
    from huggingface_hub import hf_hub_download
    model_path = hf_hub_download(
        repo_id=MODEL_ID,
        filename=SELECTED_MODEL["model_file"],
        revision=MODEL_REVISION,
    )
    ACTIVE_MODEL = ort.InferenceSession(model_path, providers=choose_ort_providers())
    ACTUAL_DEVICE = "onnx:" + "+".join(ACTIVE_MODEL.get_providers())
elif MODEL_ENGINE == "rembg":
    from rembg import new_session
    ACTIVE_MODEL = new_session(MODEL_ID, providers=choose_ort_providers())
    actual_providers = ACTIVE_MODEL.inner_session.get_providers()
    ACTUAL_DEVICE = "onnx:" + "+".join(actual_providers)
else:
    raise RuntimeError(f"Unsupported engine: {MODEL_ENGINE}")

load_seconds = time.perf_counter() - load_started
LOADED_MODEL_STATE = {
    "key": MODEL_CHOICE,
    "label": SELECTED_MODEL["label"],
    "engine": MODEL_ENGINE,
    "id": MODEL_ID,
    "revision": MODEL_REVISION,
    "device": ACTUAL_DEVICE,
    "input_mode": MODEL_INPUT_MODE,
    "input_label": MODEL_INPUT_LABEL,
    "traits": SELECTED_MODEL["traits"],
    "license": SELECTED_MODEL["license"],
    "load_seconds": load_seconds,
}

print(f"Loaded: {LOADED_MODEL_STATE['label']}")
print(f"Identity: {MODEL_ID}@{MODEL_REVISION[:12]} · engine={MODEL_ENGINE}")
print(f"Device: {ACTUAL_DEVICE}; torch={torch.__version__}; load={load_seconds:.2f}s")
print("Input:", MODEL_INPUT_LABEL)`),

    markdown(`## 3. 用經典測試圖量測去背

這格使用 scikit-image 內建的 astronaut 圖，不會上傳你的素材。它會顯示原圖、灰階 mask、透明合成結果、實際推論尺寸與中位數。

astronaut 只能檢查 adapter 是否正常，不能代表貼圖品質。請至少另外用「分離文字／emoji、多物件、同色前景、光暈粒子、半透明髮絲」素材逐一比較。`),

    code(`# @title astronaut 去背 benchmark（統一輸出同尺寸 L mask）
import statistics
from IPython.display import display
from skimage import data

LAST_INFERENCE_SIZE = None

def choose_inference_size(source: Image.Image) -> tuple[int, int]:
    if MODEL_INPUT_MODE == "dynamic":
        scale = min(1.0, INPUT_SIZE / max(source.width, source.height))
        return (
            max(32, int(source.width * scale) // 32 * 32),
            max(32, int(source.height * scale) // 32 * 32),
        )
    if MODEL_INPUT_MODE == "fixed-1024":
        return (1024, 1024)
    if MODEL_INPUT_MODE == "internal-1024":
        return (1024, 1024)
    if MODEL_INPUT_MODE == "internal-320":
        return (320, 320)
    if MODEL_INPUT_MODE == "portrait-dynamic":
        scale = min(512 / min(source.width, source.height), 1024 / max(source.width, source.height))
        return (
            max(32, round(source.width * scale / 32) * 32),
            max(32, round(source.height * scale / 32) * 32),
        )
    return (INPUT_SIZE, INPUT_SIZE)

def infer_mask(source: Image.Image) -> Image.Image:
    global LAST_INFERENCE_SIZE
    if LOADED_MODEL_STATE is None or ACTIVE_MODEL is None:
        raise RuntimeError("沒有已載入的模型；請重新執行載入格。")
    source = source.convert("RGB")
    engine = LOADED_MODEL_STATE["engine"]

    if engine == "birefnet":
        inference_width, inference_height = choose_inference_size(source)
        prepared = source.resize((inference_width, inference_height), Image.Resampling.BILINEAR)
        tensor = tensor_transform(prepared).unsqueeze(0).to(TORCH_DEVICE)
        LAST_INFERENCE_SIZE = (inference_width, inference_height)
        if TORCH_DEVICE == "cuda":
            tensor = tensor.half()
        with torch.inference_mode():
            prediction = ACTIVE_MODEL(tensor)[-1].sigmoid().float().cpu()[0, 0]
        return transforms.ToPILImage()(prediction).resize(source.size, Image.Resampling.LANCZOS).convert("L")

    if engine == "ben2":
        from ben2.modeling_ben2 import img_transform, img_transform32, postprocess_image, rgb_loader_refiner
        prepared, first_size, second_size, _ = rgb_loader_refiner(source.copy())
        transform = img_transform if TORCH_DEVICE == "cuda" else img_transform32
        tensor = transform(prepared).unsqueeze(0).to(TORCH_DEVICE)
        LAST_INFERENCE_SIZE = (1024, 1024)
        with torch.inference_mode():
            prediction = ACTIVE_MODEL(tensor)
        alpha = postprocess_image(prediction, im_size=[second_size, first_size])
        return Image.fromarray(alpha).resize(source.size, Image.Resampling.LANCZOS).convert("L")

    if engine == "modnet":
        import numpy as np
        inference_width, inference_height = choose_inference_size(source)
        prepared = source.resize((inference_width, inference_height), Image.Resampling.BILINEAR)
        pixels = np.asarray(prepared, dtype=np.float32) / 255.0
        pixels = ((pixels - 0.5) / 0.5).transpose(2, 0, 1)[None, ...]
        LAST_INFERENCE_SIZE = (inference_width, inference_height)
        input_name = ACTIVE_MODEL.get_inputs()[0].name
        prediction = np.squeeze(ACTIVE_MODEL.run(None, {input_name: pixels})[0])
        prediction = np.clip(prediction, 0.0, 1.0)
        mask = Image.fromarray((prediction * 255).astype(np.uint8), mode="L")
        return mask.resize(source.size, Image.Resampling.LANCZOS)

    if engine == "rembg":
        from rembg import remove as rembg_remove
        LAST_INFERENCE_SIZE = choose_inference_size(source)
        mask = rembg_remove(source, session=ACTIVE_MODEL, only_mask=True)
        if not isinstance(mask, Image.Image):
            mask = Image.fromarray(mask)
        return mask.resize(source.size, Image.Resampling.LANCZOS).convert("L")

    raise RuntimeError(f"Unsupported loaded engine: {engine}")

test_source = Image.fromarray(data.astronaut()).convert("RGB")
durations = []
test_mask = None
for run in range(BENCHMARK_RUNS):
    if TORCH_DEVICE == "cuda":
        torch.cuda.synchronize()
    started = time.perf_counter()
    test_mask = infer_mask(test_source)
    if TORCH_DEVICE == "cuda":
        torch.cuda.synchronize()
    durations.append(time.perf_counter() - started)
    print(f"Run {run + 1}: {durations[-1]:.3f}s")

if test_mask.size != test_source.size or test_mask.mode != "L":
    raise RuntimeError(f"adapter contract failed: mask={test_mask.mode} {test_mask.size}, source={test_source.size}")
mask_extrema = test_mask.getextrema()
if mask_extrema[0] == mask_extrema[1]:
    raise RuntimeError(f"benchmark mask is constant: {mask_extrema}")

test_result = test_source.copy()
test_result.putalpha(test_mask)
display(test_source, test_mask, test_result)

median_seconds = statistics.median(durations)
print(f"Inference input: {LAST_INFERENCE_SIZE[0]}×{LAST_INFERENCE_SIZE[1]}")
print(f"Mask range: {mask_extrema[0]}..{mask_extrema[1]}")
print(f"Median: {median_seconds:.3f}s / crop")
print("回 sticker-tool 查看『時間點 × 裁切格數』的請求數；估計純推論時間約為 median × 請求數。")
print("若速度或遮罩不可接受，先停止、換 MODEL_CHOICE、再 Run all；不必 Disconnect T4。")`),

    markdown(`## 4. 啟動臨時 API

最後一格會建立新的記憶體 session key、Uvicorn 與 Cloudflare Quick Tunnel，並持續執行以保持服務。

切換模型的正確順序：**等 sticker-tool 這一批完成 → 先停止最後一格 → 改 MODEL_CHOICE → Run all → 貼回新的 URL/key**。這不會主動斷開 T4；但 tunnel 和 session key 一定會換，舊連線也應視為失效。切換期間不要讓同一批 crop 混用兩個模型。`),

    code(`# @title 啟動 API 與 Cloudflare Quick Tunnel（保持此格執行）
import hashlib
import hmac
import io
import queue
import re
import secrets
import subprocess
import threading
import urllib.request
from typing import Annotated

from fastapi import FastAPI, File, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
import uvicorn

if LOADED_MODEL_STATE is None or ACTIVE_MODEL is None:
    raise RuntimeError("沒有已載入且 benchmark 通過的模型。")

stop_previous_services()

MAX_INPUT_BYTES = 8 * 1024 * 1024
MAX_INPUT_EDGE = 2048
MAX_INPUT_PIXELS = 4_000_000
SESSION_KEY = secrets.token_urlsafe(32)
RUNTIME_GENERATION = secrets.token_urlsafe(16)

api = FastAPI(title="sticker-tool Colab multi-model remover", docs_url=None, redoc_url=None)
api.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "X-Sticker-Tool-Key"],
)

@api.get("/health")
async def health():
    return {
        "ok": True,
        "generation": RUNTIME_GENERATION,
        "model": {key: LOADED_MODEL_STATE[key] for key in (
            "key", "label", "engine", "id", "revision", "device", "input_mode", "input_label"
        )},
        "last_inference_size": LAST_INFERENCE_SIZE,
    }

@api.post("/remove")
async def remove(
    image: Annotated[UploadFile, File(...)],
    x_sticker_tool_key: Annotated[str | None, Header()] = None,
):
    if not x_sticker_tool_key or not hmac.compare_digest(x_sticker_tool_key, SESSION_KEY):
        raise HTTPException(status_code=401, detail="invalid session key")
    if image.content_type != "image/png":
        raise HTTPException(status_code=415, detail="image must be a PNG upload")

    payload = await image.read(MAX_INPUT_BYTES + 1)
    if not payload or len(payload) > MAX_INPUT_BYTES:
        raise HTTPException(status_code=413, detail="input image exceeds the byte limit")
    try:
        with Image.open(io.BytesIO(payload)) as opened:
            width, height = opened.size
            if width > MAX_INPUT_EDGE or height > MAX_INPUT_EDGE or width * height > MAX_INPUT_PIXELS:
                raise HTTPException(status_code=413, detail="input image exceeds the decoded-pixel limit")
            source = opened.convert("RGB")
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=400, detail="image could not be decoded") from exc

    mask = infer_mask(source)
    output_buffer = io.BytesIO()
    mask.save(output_buffer, format="PNG")
    return Response(
        content=output_buffer.getvalue(),
        media_type="image/png",
        headers={"Cache-Control": "no-store"},
    )

api_config = uvicorn.Config(api, host="127.0.0.1", port=8000, log_level="warning")
api_server = uvicorn.Server(api_config)
api_server.install_signal_handlers = lambda: None
server_thread = threading.Thread(target=api_server.run, daemon=True)
server_thread.start()
for _ in range(60):
    try:
        with urllib.request.urlopen("http://127.0.0.1:8000/health", timeout=1):
            break
    except Exception:
        time.sleep(0.5)
else:
    api_server.should_exit = True
    server_thread.join(timeout=10)
    raise RuntimeError("FastAPI did not start")

CLOUDFLARED_VERSION = "2026.5.2"
CLOUDFLARED_SHA256 = "5286698547f03df745adb2355f04c12dde52ef425491e81f433642d695521886"
CLOUDFLARED_PATH = "/tmp/cloudflared"
CLOUDFLARED_URL = (
    f"https://github.com/cloudflare/cloudflared/releases/download/"
    f"{CLOUDFLARED_VERSION}/cloudflared-linux-amd64"
)

if not os.path.exists(CLOUDFLARED_PATH):
    urllib.request.urlretrieve(CLOUDFLARED_URL, CLOUDFLARED_PATH)
with open(CLOUDFLARED_PATH, "rb") as binary:
    actual_sha256 = hashlib.sha256(binary.read()).hexdigest()
if actual_sha256 != CLOUDFLARED_SHA256:
    api_server.should_exit = True
    server_thread.join(timeout=10)
    raise RuntimeError(f"cloudflared SHA-256 mismatch: {actual_sha256}")
os.chmod(CLOUDFLARED_PATH, 0o700)

tunnel_process = subprocess.Popen(
    [
        CLOUDFLARED_PATH,
        "tunnel",
        "--url", "http://127.0.0.1:8000",
        "--no-autoupdate",
    ],
    stdout=subprocess.PIPE,
    stderr=subprocess.STDOUT,
    text=True,
    bufsize=1,
)
tunnel_logs = queue.Queue()

def drain_tunnel_logs():
    assert tunnel_process.stdout is not None
    for line in tunnel_process.stdout:
        tunnel_logs.put(line)

threading.Thread(target=drain_tunnel_logs, daemon=True).start()
public_url = None
deadline = time.time() + 60
while time.time() < deadline:
    if tunnel_process.poll() is not None:
        api_server.should_exit = True
        server_thread.join(timeout=10)
        raise RuntimeError("cloudflared exited before publishing a URL")
    try:
        line = tunnel_logs.get(timeout=1)
    except queue.Empty:
        continue
    match = re.search(r"https://[-a-z0-9]+\\.trycloudflare\\.com", line)
    if match:
        public_url = match.group(0)
        break
if not public_url:
    tunnel_process.terminate()
    tunnel_process.wait(timeout=10)
    api_server.should_exit = True
    server_thread.join(timeout=10)
    raise RuntimeError("Timed out waiting for the Quick Tunnel URL")

print("\\n=== 貼回 sticker-tool 的本次連線資料 ===")
print("Endpoint URL:", f"{public_url}/remove")
print("Session key:", SESSION_KEY)
print("Model:", LOADED_MODEL_STATE["key"], "·", LOADED_MODEL_STATE["label"])
print("Device/input:", LOADED_MODEL_STATE["device"], "·", LOADED_MODEL_STATE["input_label"])
print("Generation:", RUNTIME_GENERATION)
print("========================================")
print("此格停止後 URL/key 即失效。換模型不用斷開 T4，但必須重新 Run all 並貼回新連線資料。")

try:
    while tunnel_process.poll() is None:
        time.sleep(1)
except KeyboardInterrupt:
    print("Stopping Quick Tunnel and API…")
finally:
    if tunnel_process.poll() is None:
        tunnel_process.terminate()
        try:
            tunnel_process.wait(timeout=10)
        except Exception:
            tunnel_process.kill()
            tunnel_process.wait(timeout=5)
    api_server.should_exit = True
    server_thread.join(timeout=10)
    if server_thread.is_alive():
        print("警告：Uvicorn 尚未完全停止；再次 Run all 時載入格會重試清理。")
    else:
        print("Quick Tunnel and API stopped.")`),
  ],
  metadata: {
    colab: {
      name: 'sticker-tool-birefnet-colab.ipynb',
      provenance: [],
    },
    kernelspec: {
      display_name: 'Python 3',
      language: 'python',
      name: 'python3',
    },
    language_info: {
      name: 'python',
    },
  },
  nbformat: 4,
  nbformat_minor: 5,
};

writeFileSync(output, `${JSON.stringify(notebook, null, 2)}\n`);
console.log(`Wrote ${output}`);
