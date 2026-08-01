# sticker-tool web

This is the static browser adapter for `sticker-tool`. Image processing normally runs in the browser
with Canvas, WebAssembly, and Web Workers, and the built site can be hosted on GitHub Pages.

## Workflows

| Tab | CLI equivalent | Purpose |
|---|---|---|
| Local images | `build` | Individual images to a fitted static LINE pack |
| Sprite sheet | `gen` | Background handling, gutter-aware extraction, and static packaging |
| Animated APNG | `anim` | One frame sheet to APNG, or frame groups to an animated pack |
| Video → APNG | Web only | Fixed-grid video to an editable all-frame raw master and animated pack |
| Prompt | `prompt` | Static-sheet or animation-frame prompts for external image tools |

The separate `#/colab-birefnet` route explains how to launch the optional BiRefNet notebook, benchmark
it with the built-in astronaut image, and connect a temporary Cloudflare Quick Tunnel endpoint.

## Video → APNG V2

The video workflow accepts a local video that Mediabunny and the browser can demux and decode. It does
not use `HTMLVideoElement.currentTime` seeking or a fixed 10/20/30/40/60-frame sampler.

1. Upload a video. The browser probes its container, codec, coded/display geometry, rotation, pixel
   aspect ratio, duration, first timestamp, and every decoded presentation sample.
2. Choose a global editable time window and fixed grid. Start, middle, end, and scrub previews show the
   same crop overlay. Preflight reports actual source frames, crop-frames, and a raw RGBA upper bound.
3. Confirm ingest. Every presentation sample intersecting the range is decoded in order, fed to every
   crop, and immediately released. Raw crops are written to bounded lossless APNG chunks in memory or
   IndexedDB. Equal visuals may share payload bytes, but every source timestamp/duration remains indexed.
4. Edit stickers independently. Each draft owns a source range, hard 5–20-frame target, legal
   1/2/3/4-second per-loop duration, finite loop count, background mode, and optional color ceiling.
5. Generate one preview or all dirty previews. Time-uniform candidates expand deterministically when
   adjacent equal results are removed. Delays are positive integers with the exact requested total.
   Color search may reduce colors, but never silently reduces the requested frame target.
6. Inspect the controlled canvas player. It uses frames and delays decoded from current APNG bytes and
   supports play, pause, restart, frame position, elapsed time, and progress. Only the active editor runs.
7. Save Project ZIP V2 at any time, or build a LINE ZIP after all required current bytes exist.

The beta ingest budget is 512 MiB. If preflight exceeds it, shorten the range or reduce the grid. The
budget is backed by the CFR/VFR/rotation/cancellation and 8/24-crop spike in
`scripts/video-all-frames-spike.mts`.

Background removal is never baked into V2 ingest. `none` preserves raw pixels; color-keying is local;
IMG.LY, local BiRefNet, and Colab BiRefNet are lazy, mutually exclusive render-stage choices. Only
selected candidates are processed, sequentially, with a bounded session cache. A model or remote error
does not silently fall back and does not overwrite the prior current render.

Normal LINE ZIP download is available only when every current render matches its draft and final-byte
validation passes. Missing sticker bytes are a structural hard stop. If complete bytes violate a LINE
rule, the UI lists the errors and requires explicit confirmation before downloading a file named
`NOT-LINE-COMPLIANT`.

Project ZIP V2 contains checksummed raw chunks, complete sample/visual indices, drafts, current renders,
selection/final-byte evidence, and implementation versions. It excludes source video, audio, model
caches, endpoint URLs, and session keys. Import bounds entry count and expanded bytes, rejects unsafe,
duplicate, missing, or undeclared paths, validates SHA-256 and decoded visual indices, and streams master
entries directly to the project store. V1 archives import only as `sampled-legacy`/`baked-legacy`; the UI
does not invent missing source frames or pre-removal RGB.

## Background-removal choices

- **None:** keep source alpha/RGB. This is the default for local images, animation packs, and video.
- **Solid-color key:** local Canvas operation with no model download.
- **IMG.LY local:** lazy-loads the self-hosted medium model and WASM assets (about 84 MiB). Pixels stay
  local, but first use can be slow and mobile devices may run out of memory.
- **Local BiRefNet (experimental):** lazy-loads the pinned fp16 `birefnet-lite-512` model (about 94 MiB)
  in a worker, prefers WebGPU, and falls back to local WASM.
- **Colab BiRefNet (experimental):** sends one selected crop at a time to the user's temporary endpoint,
  receives a bounded grayscale mask, and applies alpha locally. The endpoint and random key exist only
  in current React memory. Free Colab and Quick Tunnel sessions have no availability guarantee.

No model choice silently falls back to color keying. Sprite-sheet semantic removal uses overlapping
nominal crops, merges their masks over the original sheet, and then runs component-aware extraction so a
subject crossing a grid line is not clipped at a mask boundary.

## Architecture

- `../src/core/` contains platform-neutral specification, validation, timeline, grid, and prompt rules.
- `src/webpipe/` implements browser raster, background removal, APNG, video, storage, and ZIP adapters.
- `videoSource.ts` uses Mediabunny/WebCodecs and closes every decoded `VideoSample` promptly.
- `rawVideoMaster.ts`, `masterApng.ts`, and `videoMasterStore.ts` own all-frame raw storage.
- `processMasterApngSticker.ts` owns exact-target selection, lazy transforms, encoding, and final-byte
  evidence. `videoFrameRenderCache.ts` bounds session transform results.
- `videoProjectZip.ts` owns asynchronous V2 export, strict streaming import, and explicit V1 mapping.
- `upng-js` encodes PNG/APNG and `fflate` handles archive streams.
- IMG.LY and Transformers.js runtime assets are copied into the build for local lazy loading.
- `public/coi-serviceworker.js` supplies COOP/COEP behavior where static hosting cannot set headers.

## Development

```bash
npm install
npm run dev
npm run typecheck
npm run build
npm run test:colab
npm run test:local-birefnet
npm run test:background-removal
npm run test:video          # V2 round-trip, strict rejection, V1 mapping, render contracts
npm run test:video-spike    # requires ffmpeg/ffprobe
npm run preview -- --port 4179
node scripts/smoke.mjs http://127.0.0.1:4179/
node scripts/video-smoke.mjs http://127.0.0.1:4179/ # requires ffmpeg and Chrome
```

The video browser smoke asserts that a 12-frame fixture persists all 12 sample references, exercises
exact-target editing and controlled playback, round-trips Project V2 without a source decoder, verifies
invalid-package confirmation, and builds a valid eight-sticker LINE package.

## Deployment

Set GitHub Pages to **GitHub Actions**. The repository workflow builds on pushes to `main` or `master`.
Vite uses `base: './'`, so the static artifact works below a repository subpath.
