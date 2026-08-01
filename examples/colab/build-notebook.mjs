import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const output = fileURLToPath(new URL('./sticker-tool-birefnet-colab.ipynb', import.meta.url));

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
    markdown(`# sticker-tool · Colab BiRefNet 去背

這個 Notebook 會在你自己的 Google Colab runtime 載入 BiRefNet、先用 scikit-image 經典的 astronaut 測試圖量測單張去背時間，再視需要啟動臨時 HTTPS API。

重要限制：

- 免費 Colab 沒有保證或無限 runtime；VM 可能 idle timeout，單次 runtime 最長通常不超過 12 小時。
- API 只在最後一格持續執行時存在。停止、斷線或刪除 runtime 後，網址與 session key 都失效。
- Quick Tunnel 是臨時公開網址。API 仍以本次 runtime 隨機 session key 驗證每個請求。
- 先跑 benchmark。若 CPU 的「每 crop 秒數 × sticker-tool 預估請求數」無法接受，就不要啟動 API。

依序執行所有格子；benchmark 後可停下來決定是否繼續。`),

    markdown(`## 1. 選擇模型與運算裝置

建議先用 **lite + auto + 512**：

- \`lite\`：44.4M 參數，適合免費 Colab 與 CPU fallback。
- \`full\`：細節通常較好，但 CPU 很慢、記憶體與 GPU 需求更高。
- \`dynamic\`：0.2B 參數，保留來源長寬比並把兩邊調整為 32 的倍數；建議使用 GPU。
- \`auto\`：有 CUDA 就用 GPU，否則使用 CPU。
- \`gpu\`：沒有 CUDA 時直接報錯，不會偷偷退回 CPU。
- \`cpu\`：方便你明確量測免費標準 VM。

\`INPUT_SIZE\` 對 lite/full 是固定正方形尺寸；對 dynamic 則是最長邊上限。dynamic 不會放大小圖。`),

    code(`# @title BiRefNet 設定
MODEL_CHOICE = "lite" # @param ["lite", "full", "dynamic"]
DEVICE_CHOICE = "auto" # @param ["auto", "gpu", "cpu"]
INPUT_SIZE = 512 # @param [512, 1024] {type:"raw"}
BENCHMARK_RUNS = 1 # @param [1, 3] {type:"raw"}

MODEL_OPTIONS = {
    "lite": {
        "id": "ZhengPeng7/BiRefNet_lite",
        "revision": "7838f1c3472f827cd8ce13ab5ccc2ce48077360f",
        "input_mode": "fixed",
    },
    "full": {
        "id": "ZhengPeng7/BiRefNet",
        "revision": "b7d7f31fed203ab364ac756d62053ee467502434",
        "input_mode": "fixed",
    },
    "dynamic": {
        "id": "ZhengPeng7/BiRefNet_dynamic",
        "revision": "280306042f57b7a33854319da62fd86aaa89ec4c",
        "input_mode": "dynamic",
    },
}

if MODEL_CHOICE not in MODEL_OPTIONS:
    raise ValueError("MODEL_CHOICE must be lite, full, or dynamic")
if DEVICE_CHOICE not in {"auto", "gpu", "cpu"}:
    raise ValueError("DEVICE_CHOICE must be auto, gpu, or cpu")
if INPUT_SIZE not in {512, 1024}:
    raise ValueError("INPUT_SIZE must be 512 or 1024")
if BENCHMARK_RUNS not in {1, 3}:
    raise ValueError("BENCHMARK_RUNS must be 1 or 3")

MODEL_INPUT_MODE = MODEL_OPTIONS[MODEL_CHOICE]["input_mode"]
MODEL_INPUT_LABEL = f"source aspect, max edge {INPUT_SIZE}, /32" if MODEL_INPUT_MODE == "dynamic" else f"{INPUT_SIZE}×{INPUT_SIZE}"
print("Selected:", MODEL_CHOICE, DEVICE_CHOICE, MODEL_INPUT_LABEL, f"{BENCHMARK_RUNS} benchmark run(s)")`),

    code(`# @title 清理衝突的預裝套件並安裝固定版本
# Colab 可能預裝 google-adk、gradio 與 python-fasthtml；本 Notebook 不使用它們，
# 而且它們要求的 FastAPI/Starlette/Hugging Face Hub 版本與固定的 BiRefNet 環境衝突。
# 移除只影響這次臨時 runtime；Disconnect and delete runtime 後即消失。
%pip uninstall -q -y google-adk gradio python-fasthtml
%pip install -q "transformers==4.48.3" "timm==1.0.15" "kornia==0.7.4" "einops==0.8.0" "accelerate==1.2.1" "fastapi==0.115.6" "uvicorn==0.34.0" "python-multipart==0.0.20" "scikit-image==0.24.0"`),

    markdown(`## 2. 載入模型

第一次會下載固定 revision 的模型與程式碼。下載時間不計入單張 inference benchmark，但會另外顯示模型載入秒數。`),

    code(`# @title 載入固定 revision 的 BiRefNet
import time
import torch
from torchvision import transforms
from transformers import AutoModelForImageSegmentation

if DEVICE_CHOICE == "gpu" and not torch.cuda.is_available():
    raise RuntimeError("你選了 gpu，但這個 Colab runtime 沒有 CUDA。請改成 auto/cpu，或到 Runtime → Change runtime type 選 GPU。")

DEVICE = "cuda" if DEVICE_CHOICE in {"auto", "gpu"} and torch.cuda.is_available() else "cpu"
MODEL_ID = MODEL_OPTIONS[MODEL_CHOICE]["id"]
MODEL_REVISION = MODEL_OPTIONS[MODEL_CHOICE]["revision"]

load_started = time.perf_counter()
model = AutoModelForImageSegmentation.from_pretrained(
    MODEL_ID,
    revision=MODEL_REVISION,
    trust_remote_code=True,
)
model = model.to(DEVICE).eval()
if DEVICE == "cuda":
    torch.set_float32_matmul_precision("high")
    model = model.half()

tensor_transform = transforms.Compose([
    transforms.ToTensor(),
    transforms.Normalize(
        mean=[0.485, 0.456, 0.406],
        std=[0.229, 0.224, 0.225],
    ),
])
load_seconds = time.perf_counter() - load_started
print(f"Model: {MODEL_ID}@{MODEL_REVISION[:12]}")
print(f"Device: {DEVICE}; torch={torch.__version__}; load={load_seconds:.2f}s")`),

    markdown(`## 3. 用經典測試圖量測去背

這格使用 scikit-image 內建的 astronaut 圖，不會上傳你的素材。它會顯示原圖、mask、透明合成結果與實測秒數。`),

    code(`# @title astronaut 去背 benchmark
import statistics
from PIL import Image
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
    return (INPUT_SIZE, INPUT_SIZE)

def infer_mask(source: Image.Image) -> Image.Image:
    global LAST_INFERENCE_SIZE
    source = source.convert("RGB")
    inference_width, inference_height = choose_inference_size(source)
    prepared = source.resize((inference_width, inference_height), Image.Resampling.BILINEAR)
    tensor = tensor_transform(prepared).unsqueeze(0).to(DEVICE)
    LAST_INFERENCE_SIZE = (inference_width, inference_height)
    if DEVICE == "cuda":
        tensor = tensor.half()
    with torch.inference_mode():
        prediction = model(tensor)[-1].sigmoid().float().cpu()[0, 0]
    return transforms.ToPILImage()(prediction).resize(source.size, Image.Resampling.LANCZOS).convert("L")

test_source = Image.fromarray(data.astronaut()).convert("RGB")
durations = []
test_mask = None
for run in range(BENCHMARK_RUNS):
    if DEVICE == "cuda":
        torch.cuda.synchronize()
    started = time.perf_counter()
    test_mask = infer_mask(test_source)
    if DEVICE == "cuda":
        torch.cuda.synchronize()
    durations.append(time.perf_counter() - started)
    print(f"Run {run + 1}: {durations[-1]:.3f}s")

test_result = test_source.copy()
test_result.putalpha(test_mask)
display(test_source, test_mask, test_result)

median_seconds = statistics.median(durations)
print(f"Inference input: {LAST_INFERENCE_SIZE[0]}×{LAST_INFERENCE_SIZE[1]}")
print(f"Median: {median_seconds:.3f}s / crop")
print("回 sticker-tool 查看『時間點 × 裁切格數』的請求數；估計純推論時間約為 median × 請求數。")
print("若這個速度與結果不可接受，請在這裡停止，不要啟動臨時 API。")`),

    markdown(`## 4. 啟動臨時 API

只有 benchmark 可接受才執行下一格。它會：

1. 建立只存在記憶體的隨機 session key。
2. 在 Colab 內啟動 FastAPI。
3. 下載並驗證固定版本的官方 \`cloudflared\` binary。
4. 建立臨時 \`*.trycloudflare.com\` HTTPS URL。

最後一格會持續執行以保持服務。把輸出的 endpoint URL 與 session key 貼回 sticker-tool；完成後按停止，並用 Colab 的 **Disconnect and delete runtime** 清除 VM。`),

    code(`# @title 啟動 API 與 Cloudflare Quick Tunnel（保持此格執行）
import hashlib
import hmac
import io
import os
import queue
import re
import secrets
import subprocess
import threading
import time
import urllib.request
from typing import Annotated

from fastapi import FastAPI, File, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
import uvicorn

MAX_INPUT_BYTES = 8 * 1024 * 1024
MAX_INPUT_EDGE = 2048
MAX_INPUT_PIXELS = 4_000_000
SESSION_KEY = secrets.token_urlsafe(32)

api = FastAPI(title="sticker-tool Colab BiRefNet", docs_url=None, redoc_url=None)
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
        "model": MODEL_CHOICE,
        "device": DEVICE,
        "input_mode": MODEL_INPUT_MODE,
        "input_size": MODEL_INPUT_LABEL,
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
    output = io.BytesIO()
    mask.save(output, format="PNG")
    return Response(
        content=output.getvalue(),
        media_type="image/png",
        headers={"Cache-Control": "no-store"},
    )

def run_api():
    uvicorn.run(api, host="127.0.0.1", port=8000, log_level="warning")

server_thread = threading.Thread(target=run_api, daemon=True)
server_thread.start()
for _ in range(60):
    try:
        with urllib.request.urlopen("http://127.0.0.1:8000/health", timeout=1):
            break
    except Exception:
        time.sleep(0.5)
else:
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
    raise RuntimeError(f"cloudflared SHA-256 mismatch: {actual_sha256}")
os.chmod(CLOUDFLARED_PATH, 0o700)

if "tunnel_process" in globals() and tunnel_process.poll() is None:
    tunnel_process.terminate()
    tunnel_process.wait(timeout=10)

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
    raise RuntimeError("Timed out waiting for the Quick Tunnel URL")

print("\\n=== 貼回 sticker-tool 的本次連線資料 ===")
print("Endpoint URL:", f"{public_url}/remove")
print("Session key:", SESSION_KEY)
print("Model/device/input:", MODEL_CHOICE, DEVICE, MODEL_INPUT_LABEL)
print("========================================")
print("此格停止、runtime 斷線或刪除後，URL 與 session key 都會失效。")

try:
    while tunnel_process.poll() is None:
        time.sleep(1)
except KeyboardInterrupt:
    print("Stopping Quick Tunnel…")
finally:
    if tunnel_process.poll() is None:
        tunnel_process.terminate()
        tunnel_process.wait(timeout=10)
    print("Quick Tunnel stopped.")`),
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
