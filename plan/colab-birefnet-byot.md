# Colab BYO BiRefNet implementation record

- Status: implemented as an experimental Web option
- User surface: independent `#/colab-birefnet` tutorial plus Video → APNG background-removal choice
- Compute owner: the user's temporary Google Colab runtime
- Tunnel: anonymous Cloudflare Quick Tunnel, temporary and random

## Contract

The browser sends one cropped PNG at a time:

```text
POST https://<random>.trycloudflare.com/remove
X-Sticker-Tool-Key: <per-runtime random key>
Content-Type: multipart/form-data; image=<PNG>
Accept: image/png
```

The worker returns one 8-bit grayscale PNG mask with the same dimensions. The browser multiplies that
mask into the crop's existing alpha before the normal master-APNG resize and encode path.

The client and Notebook both enforce an 8 MiB encoded upload limit, 2048 px maximum edge, and
4,000,000 decoded-pixel limit. The client also caps response bytes and checks the PNG signature,
dimensions, grayscale channels, redirect policy, and endpoint hostname/path.

## Notebook choices and benchmark

- Model: `ZhengPeng7/BiRefNet_lite`, `ZhengPeng7/BiRefNet`, or
  `ZhengPeng7/BiRefNet_dynamic`, all pinned to exact revisions.
- Device: `auto`, `gpu`, or `cpu`; an unavailable explicit GPU is an error.
- Model input: lite/full use 512 or 1024 square; dynamic treats that choice as a maximum edge,
  does not upscale smaller crops, preserves the source aspect ratio, and rounds both dimensions
  down to multiples of 32.
- Benchmark runs: one or three.
- Fixture: `skimage.data.astronaut()`, displayed as source, mask, and RGBA result.
- The install cell removes the unused preinstalled `google-adk`, `gradio`, and `python-fasthtml`
  packages before applying the pinned BiRefNet dependency set, avoiding their incompatible FastAPI,
  Starlette, and Hugging Face Hub constraints in the disposable runtime.

The benchmark reports model load time and median seconds per crop. The product UI separately reports
`master sample count × source cell count`; users are instructed to multiply the two before starting.

## Runtime and security boundaries

- The Notebook starts FastAPI on loopback, then exposes it through a fixed-version `cloudflared`
  binary whose SHA-256 is verified before execution.
- CORS is public because the static web app and temporary tunnel are different origins.
- Every POST requires a random key generated only in runtime memory.
- The browser accepts only `https://*.trycloudflare.com/remove`, rejects redirects, and omits browser credentials.
- URL and key live only in current React memory. They are not written to storage, URL state, logs,
  downloads, screenshots, source, or Project ZIP metadata.
- Stopping the last Notebook cell or deleting the runtime invalidates the connection.

## Known limitations

- Free Colab has dynamic limits, idle timeout, and at most roughly 12 hours per runtime; there is no SLA.
- Quick Tunnels are intended for tests and temporary use, not production hosting.
- CPU inference can be too slow for `sample count × cell count`; the benchmark is the product gate.
- The model is per-image and has no temporal consistency mechanism.
- Real Colab CPU/GPU benchmark values and a browser-to-live-tunnel smoke test must be recorded before
  making quality or performance claims.
