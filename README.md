# sticker-tool

`sticker-tool` turns local images or externally generated sprite sheets into deterministic packages that target the [LINE Creators Market](https://creator.line.me/en/guideline/sticker) format.

It provides two execution surfaces:

- A Node.js CLI for deterministic image processing, APNG encoding, validation, and ZIP packaging.
- A static React web app that performs the work in the browser without uploading user images.

AI image generation is intentionally outside the application. Use any image generator, the prompt builder, or the project-local skills under `.claude/skills/`, then give the resulting images to the CLI or web app.

## Features

- Static sticker packs from individual PNG, JPEG, or WebP files.
- Static packs from one or more sprite sheets.
- Animated APNG stickers from frame files or a frame sheet.
- Animated APNG packs cropped from a fixed-grid video sheet in the browser.
- Transparent, green-screen, and opaque-background handling.
- Content-aware sheet cutting that finds gutters and preserves components crossing nominal grid lines.
- Canvas fitting, even dimensions, transparent margins, optional outlines, and text overlays.
- Static PNG quantization and animated color/frame reduction to fit the 1 MB limit.
- `main.png`, `tab.png`, numbered sticker files, ZIP packaging, and shared metadata-based LINE checks.
- Browser-side previews, downloads, grid mismatch warnings, and manual animation alignment.
- Prompt generation for static sticker sheets and animation frame sheets.

## Requirements

- Node.js 20 or newer.
- A local font file (`.otf` or `.ttf`) when the CLI needs to render non-system text reliably.
- Network access on the first semantic background-removal run so the model assets can be obtained.

## CLI quick start

Install dependencies:

```bash
npm ci
npm run sticker -- --help
```

Create a static pack from a directory of images:

```bash
npm run sticker -- build ./input \
  --count 8 \
  --out ./out \
  --name "My Pack" \
  --stroke
```

Input files are selected in natural filename order. The command writes `main.png`, `tab.png`, `01.png` onward, and `My_Pack.zip` to the output directory.

Create a configuration file and package an existing sprite sheet:

```bash
npm run sticker -- init --out sticker.config.yaml
npm run sticker -- gen \
  --config sticker.config.yaml \
  --sheet ./sheet.png \
  --out ./out
```

Create one APNG from a frame sheet:

```bash
npm run sticker -- anim \
  --sheet ./frames.png \
  --grid 4x4 \
  --frames 16 \
  --duration 2 \
  --loops 1 \
  --out ./out \
  --name wave
```

Create a complete animated pack from `stickers[].frames` in a configuration file:

```bash
npm run sticker -- anim --config anim.config.yaml --out ./out
```

Each `stickers[].frames` entry must contain 5–20 individual frame image paths. It does not accept a frame-sheet PNG or an already encoded APNG as one entry.

Generate a prompt without calling an image model:

```bash
npm run sticker -- prompt --config sticker.config.yaml
```

The CLI prompt command currently emits the static sheet prompt even for animated configurations. Use the web app's animation-frame prompt mode when an animated prompt is required; this mismatch is tracked in the implementation audit.

Build the distributable CLI:

```bash
npm run typecheck
npm run build
```

The build produces `dist/index.js` and exposes it through the `sticker-tool` package binary.

## Configuration

The CLI accepts YAML or JSON. Run `init` for the annotated example, or start from [examples/sticker.config.yaml](examples/sticker.config.yaml).

```yaml
package:
  name: "My Stickers"
  count: 8
  # animated: true

source: ai # ai | local

ai:
  style: "flat cartoon, bold outline, pastel palette"
  transparent: true
  isCharacter: true
  grid: auto # auto | "4x2"
  crop: equal # accepted by schema; current gen path uses component-aware cutSheet instead
  forceOversizeSet: false

processing:
  removeBackground: auto # true | false | auto
  stroke:
    enabled: true
    width: 8
    color: "#ffffff"

cover: 1

animation:
  loops: 1
  durationSec: 2 # current pipeline treats this as per-loop; use only 1, 2, 3, or 4
  autoFit: true # accepted by schema; current animation pipeline always auto-fits
  priority: balanced
  minColors: 16
  maxColors: 0
  minFrames: 5
  ladder: auto

stickers:
  - frames: [wave_01.png, wave_02.png, wave_03.png, wave_04.png, wave_05.png]
    text:
      content: "Hi"
      x: 50
      y: 88
      size: 40
      color: "#000000"
      font: ./fonts/NotoSansTC-Bold.otf
```

Paths declared inside the configuration file, such as frame and font paths, resolve relative to that file. CLI arguments such as `--sheet` and `--out` resolve relative to the current working directory. Command-line `--count` and `--name` values override the configuration.

The current schema accepts some fields that are not consumed consistently by every workflow, including `ai.crop`, `animation.autoFit`, and several per-sticker generation fields. See [plan/implementation-audit.md](plan/implementation-audit.md) before relying on advanced configuration.

## Web app

The web application is under [`web/`](web/). It has five tabs. Four correspond to CLI workflows; the
video workflow is browser-only:

- Local images → static pack.
- Sprite sheet → static pack.
- Frame sheet or frame groups → APNG or animated pack.
- Fixed-grid video → editable master APNG chunks → adjusted animated pack.
- Static or animated image prompt generation.

Run it locally:

```bash
cd web
npm ci
npm run dev
```

Build the static site:

```bash
npm run build
npm run preview
```

The GitHub Pages workflow builds and deploys the site on pushes to either `main` or `master`. See [web/README.md](web/README.md) for browser-specific behavior and smoke-test instructions.

The web app processes image and video pixels locally. Its general photo background-removal path uses a self-hosted browser model downloaded from the deployed site and cached by the browser. Sprite-sheet, single-sheet animation, and video workflows use deterministic transparent/green/solid-color keying instead of that model.

The **Video → APNG** tab accepts a browser-decodable local video such as MP4, MOV, or WebM. It samples
an explicit editable time window, applies one stable grid to every sampled frame, and writes bounded
internal master APNG chunks. Per-sticker start/end time, output frame count, playback duration, loop
count, and color reduction can then be changed without reopening the video. A LINE ZIP contains only
`main.png`, `tab.png`, and numbered APNG files. A separate editable Project ZIP contains the master
chunks, immutable baseline renders, current adjusted renders, metrics, and a versioned manifest; it
does not contain the source video or audio.

The video source grid may contain any positive number of cells, including fewer than the 8 stickers
required for a LINE animated pack. Such sources can still produce editable APNGs and a Project ZIP;
the LINE ZIP validation gate continues to require 8, 16, or 24 stickers. Solid-color keying is off by
default because a black background may share pixels with hair, eyes, clothing, or text outlines.

## LINE constraints targeted by the project

| Constraint | Static | Animated |
|---|---:|---:|
| Sticker canvas | Up to 370×320 | Up to 320×270, with one side at least 270 px |
| Dimensions | Even, transparent RGBA | Even, transparent RGBA |
| File size | At most 1 MB | At most 1 MB |
| Pack counts | 8, 16, 24, 32, or 40 | 8, 16, or 24 |
| Animation | — | APNG, 5–20 frames, 1–4 loops |
| Main image | 240×240 PNG | 240×240 APNG |
| Tab image | 96×74 PNG | 96×74 PNG |

The final ZIP is limited to 60 MB. Static and animated stickers cannot be mixed in one pack.

The current validator checks much of this metadata, but validation success is not proof that a package is uploadable. It does not yet fully verify decoded visual transparency/content, exact animation timing, distinct animation frames, or all main/tab constraints. The source-grounded list of known functional and compliance gaps is [plan/implementation-audit.md](plan/implementation-audit.md).

## Project layout

```text
src/core/       Shared platform-neutral rules, grid/cell analysis, prompts, and validation
src/config/     YAML/JSON schema validation and normalization
src/pipeline/   Node image processing and APNG implementation
src/package/    Main/tab generation and ZIP assembly
src/cli/        Command-line entry point and commands
web/src/ui/     React workflow tabs and result views
web/src/webpipe Browser image-processing adapters
web/src/ui/VideoTab.tsx Browser-only video-to-APNG project workflow
.claude/skills/ Project-local generation and packaging workflows
```

Read [ARCHITECTURE.md](ARCHITECTURE.md) for the component boundaries, data flows, and design decisions.

## Operational notes

- Character identity is most reliable when all poses are generated in one sheet from one reference image. Eight cells give the best detail; 16 cells are supported with a quality warning. Prompt planning requires an explicit override for larger character sheets, while packaging a pre-existing sheet currently only warns.
- Node semantic background removal uses `@imgly/background-removal-node` and may download model assets on first use.
- Browser sprite-sheet cutting uses color keying. Prefer real transparency or a flat green background when the subject contains colors similar to an opaque background.
- Animated frame files are stabilized before fitting. Frame sheets skip the later subject-anchor stabilizer, but the current grid extraction also applies scene and lower-body alignment; this can suppress intentional motion such as jumping.
- The CLI overwrites files produced by the current run but does not clean unrelated or stale files from an existing output directory. The ZIP contains only files from the current run.
- The generated-image and packaging workflows are separated so a packaging adjustment does not require regenerating artwork.
- Video codec support follows the current browser media stack. The video workflow uses time-uniform
  seek samples rather than claiming to enumerate every compressed source frame, and it ignores source
  audio because the Creators Market animated-sticker upload set has no audio file entry.
