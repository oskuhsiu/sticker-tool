# sticker-tool web

This is the static browser adapter for `sticker-tool`. Image processing normally runs in the browser
with Canvas, WebAssembly, and Web Workers, and the built site can be hosted on GitHub Pages.

## Workflows

| Tab | CLI equivalent | Purpose |
|---|---|---|
| Local images | `build` | Individual images to a fitted Regular Sticker or Regular Emoji pack |
| Sprite sheet | `gen` for regular static/Emoji packs | Pre-process cut guide, gutter-aware extraction, and Regular Sticker, Big Sticker, or Regular Emoji packaging |
| Animated APNG | `anim` for regular animation/Emoji | One frame sheet to APNG, frame groups to an Animated Sticker or Animated Regular Emoji pack, or paired static/frame inputs to a browser-only Pop-up Sticker pack |
| Video → APNG | Web only | Fixed-grid video to an editable all-frame raw master and animated pack |
| Prompt | `prompt` | Sticker- or Emoji-aware static-sheet and animation-frame prompts for external image tools |

The separate `#/colab-birefnet` route explains how to launch the optional BiRefNet notebook, benchmark
it with the built-in astronaut image, and connect a temporary Cloudflare Quick Tunnel endpoint.

## Regular Emoji workflows

[Regular Emoji](https://creator.line.me/en/guideline/emoji/) is integrated into the existing tabs; it
does not have a separate top-level page. Choose **Regular Emoji** in Local images or Sprite sheet for a
static package. Choose **Animated Regular Emoji** in either the frame-sheet or grouped-frame mode under
Animated APNG. Prompt has matching static and animated targets, including small-inline readability and
first-frame guidance.

Both products accept any integer count from 8 through 40 and emit exact 180×180 transparent truecolor
items. Static items are PNG files up to 1,000,000 bytes. Animated items are APNG files with a `.png`
extension, 5–20 frames, 1–4 loops, an exact 1/2/3/4-second one-loop duration, total playback no longer
than four seconds, at least two distinct decoded frames, and at most 300,000 bytes. A 96×74 `tab.png`
is required. There is no uploaded `main.png`; four registered emoji are selected for the main display
later in LINE My Page.

The downloaded ZIP has this exact shape:

```text
tab.png
001.png
002.png
…
```

The static ZIP must be strictly smaller than 20,000,000 bytes; the animated ZIP may equal that limit.
The browser validates the expected paths and target-specific final bytes before enabling download. A
blocking error leaves ZIP download unavailable rather than producing a knowingly invalid archive.
Result cards show each item at 180×180 and a representative 32×32 inline size. Animated results also
show decoded frames, loops, one-loop duration, distinct-frame count, and exact encoded bytes.

Static Emoji keeps original colors on the first pass and offers an explicit reduction retry after a
byte-limit failure. Animated Emoji exposes `Original`, 256, 128, and 64-color choices; `Original` does
not quantize, while reduced choices retain all selected frames. Frame-sheet counts outside 5–20 and
grouped-pack items outside 5–20 are rejected before encoding. Over-budget output remains a hard error.

Regular Emoji V1 does not implement the six fixed Kana/letter/number/symbol set contracts. The Video
tab cannot export Animated Emoji, and the application neither authenticates with nor uploads directly
to Creators Market. The local ZIP shape and final-byte validators have been exercised, but current My
Page acceptance has not been verified. PNG density may remain unknown, and semantic requirements such
as small-size legibility or first-frame meaning still require human review.

## Sprite sheet and Big Stickers

Selecting a sprite sheet displays a nominal equal-grid overlay before background removal or cutting.
The overlay uses row-major `01`… numbering and shares the rendered image bounds, so it remains aligned
while the image scales. It is a planning guide: the actual component-aware cutter may move the reference
lines to nearby transparent gutters and preserves components that cross a nominal line.

The Sprite sheet tab can produce either a regular static pack or a
[LINE Big Sticker](https://creator.line.me/en/guideline/bigsticker/) pack. Big Sticker images use even
RGBA PNG dimensions from 80×524 through 396×660, at most 1 MB each, and no proactively added display
margin; LINE adds the appropriate margin. Content is scaled proportionally and transparent-padded to
the minimum canvas instead of being stretched. Counts remain 8, 16, 24, 32, or 40, and the final ZIP
remains limited to 60 MB. Numbered output is truecolor RGBA, not indexed PNG. The first package keeps
the original colors; after a byte-limit failure, the result offers an explicit color-reduction retry
that still emits truecolor RGBA. Main and tab images remain 240×240 and 96×74. This Big Sticker mode is
Web-only; the CLI `gen` command continues to produce regular static stickers.

Custom sheet grids are bounded before the SVG cut guide or cutter allocates cells. Values above 64 on
either axis or above 400 total cells are rejected; LINE's largest supported static/Big pack needs only
40 cells.

## Pop-up Sticker packages

The third mode inside the Animated APNG tab targets
[LINE Pop-up Stickers](https://creator.line.me/en/guideline/popupsticker/). It requires two deliberate
input sets: 8, 16, or 24 static source images, plus one natural-sorted 5–20-frame sequence for each
corresponding pop-up animation. The browser never assumes that animation frame 1 is the static sticker.

V1 emits each pop-up APNG on a fixed 480×480 transparent canvas. LINE also allows other canvases with
one side exactly 480, subject to a minimum 320-pixel height when width is 480 and a minimum 200-pixel
width when height is 480; the fixed square is a valid subset and can also serve as the required
480×480 `main_popup.png`. Static numbered files are fitted to at most 370×320 without proactively added
margin. The selected static cover produces `main.png` and `tab.png`.

The downloaded ZIP has this exact structure:

```text
png/main.png
png/tab.png
png/01.png …
popup/main_popup.png
popup/01.png …
```

The folder names and cover/tab placement follow LINE's official production-guide diagram; the current
Creators Market pages remain the authority for the 1 MB asset limit and 8/16/24 pack counts.

Every final APNG is decoded again before package validation. The checks require 5–20 frames, at least
two distinct visuals, 1–3 finite loops, an exact 1/2/3-second per-loop duration, no more than three
seconds across all loops, transparent visible content, truecolor RGBA output (indexed PNG/APNG is
rejected), and at most 1 MB per image. The ZIP remains
limited to 60 MB. The Top, Center, or Bottom display position is selected later in LINE My Page and is
not encoded into the package. This workflow is Web-only.

Color reduction is opt-in rather than an automatic packaging step. The browser first encodes and
validates original-color truecolor assets. Only an over-budget result offers a retry with color
reduction; quantized candidates remain truecolor RGBA and preserve the selected frame count. After each
APNG is encoded and inspected, its fitted 480×480 RGBA frame buffers are discarded instead of being
retained for the rest of the pack.

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
- `src/webpipe/emojiZip.ts` assembles and validates the main-less, three-digit Emoji archive separately
  from sticker and Pop-up package shapes.
- `src/ui/packResult.tsx` uses a discriminated result model so Emoji previews cannot accidentally render
  or package a sticker `main.png`.
- `src/ui/PopupPackMode.tsx` owns paired static/pop-up inputs, processing progress, previews, and package download.
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
npm run test:output-safety # truecolor Big/Pop-up and opt-in reduction contracts
npx tsx --tsconfig tsconfig.json scripts/emoji-processing-contract.mts
npm run test:video          # V2 round-trip, strict rejection, V1 mapping, render contracts
npm run test:video-spike    # requires ffmpeg/ffprobe
npm run preview -- --port 4179
node scripts/smoke.mjs http://127.0.0.1:4179/
node scripts/emoji-smoke.mjs http://127.0.0.1:4179/
node scripts/video-smoke.mjs http://127.0.0.1:4179/ # requires ffmpeg and Chrome
```

The video browser smoke asserts that a 12-frame fixture persists all 12 sample references, exercises
exact-target editing and controlled playback, round-trips Project V2 without a source decoder, verifies
invalid-package confirmation, and builds a valid eight-sticker LINE package.

The main browser smoke also rejects an extreme custom preview grid, checks truecolor Big output, builds
an eight-item Pop-up Sticker pack, and verifies the color type and all 19 expected ZIP entries in
addition to exercising the existing static, animated, and prompt paths.

The Emoji processing contract covers exact static fitting, shared animated-sequence fitting, preserved
frame counts, final decoded facts, and output safety. The dedicated Emoji browser smoke drives both
static and animated UI journeys, opens both ZIP downloads, asserts `tab.png` plus three-digit items with
no `main.png`, and reopens the animated bytes to verify canvas, color type, frames, loops, duration, and
distinct motion. It can also be invoked as `npm run smoke:emoji -- http://127.0.0.1:4179/`.

## Deployment

Set GitHub Pages to **GitHub Actions**. The repository workflow builds on pushes to `main` or `master`.
Vite uses `base: './'`, so the static artifact works below a repository subpath.
