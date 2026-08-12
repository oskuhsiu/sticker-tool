# Architecture

Last verified against the source tree on 2026-08-12.

## Purpose and boundaries

`sticker-tool` is a deterministic post-processing and packaging system for LINE sticker and Regular Emoji assets. It accepts local images, sprite sheets, or animation frames and produces Regular Sticker PNG/APNG, Regular Emoji PNG/APNG, browser Big Sticker PNG, or paired browser Pop-up Sticker packages plus target-specific validation results.

The system deliberately does not call an AI image-generation API. Artwork can come from any external tool. The prompt builder and project-local skills help create suitable inputs, while the application owns repeatable image processing, packaging, and LINE-spec checks.

## System overview

```text
Local images ───────────────┐
External image generator ───┼──> CLI or browser workflow
Prompt builder ─────────────┘             │
                                          ├──> shared core decisions and validation
                                          ├──> platform-specific image pipeline
                                          └──> target-specific support/numbered files + ZIP or download
```

There are two runtime surfaces:

1. The Node.js CLI, bundled as one ESM entry point while keeping native and third-party dependencies external.
2. A Vite/React static web app, deployed to GitHub Pages and executed in the browser. Its image workflows share five explicit background modes: none, solid-color keying, browser-local IMG.LY, browser-local BiRefNet, and one selected model through a temporary Google Colab session started by the user.

Both surfaces import `src/core/` directly. They intentionally have separate image I/O implementations because Node uses `sharp` and `Buffer`, while the browser uses Canvas-compatible RGBA arrays and `Uint8Array`.

## Repository structure

### Shared core: `src/core/`

The shared core contains no Node filesystem or browser DOM dependencies.

- `spec.ts` defines LINE regular-static, Big Sticker, animated, Pop-up Sticker, static/animated Regular Emoji, count, byte, frame, loop, support-image, naming, and ZIP limits.
- `types.ts` defines normalized configuration and pipeline contracts.
- `validate.ts` keeps sticker and emoji item/package validation separate. Emoji validation consumes evidence decoded from final PNG/APNG bytes and validates its own three-digit, main-less manifest.
- `grid.ts` plans sprite-sheet dimensions and enforces character-sheet quality thresholds.
- `sheet.ts` infers grid dimensions and finds low-occupancy gutter bands from foreground projections.
- `cells.ts` performs connected-component assignment, preserves content that crosses nominal grid lines, and lays cells out for static or animated use.
- `prompt.ts` builds static-sheet and animation-frame prompts without invoking a model. Both prompt
  types include background-removal-safe text guidance: unrequested text is prohibited, while requested
  lettering and symbols are rendered as opaque foreground artwork connected to the main subject.
- `naming.ts` provides separate two-digit sticker and three-digit emoji naming plus the expected emoji archive manifest; `color.ts` provides deterministic color parsing helpers.

This directory is the compatibility boundary between the CLI and web app. Shared behavioral changes should be implemented here when they do not require platform APIs.

### CLI and configuration: `src/cli/`, `src/config/`

`src/cli/index.ts` registers five Commander commands and extends the existing commands with an Emoji product selection:

- `build`: individual local images to a static Sticker or Regular Emoji pack; `--product emoji` is the direct-input selector.
- `gen`: one or more existing sprite sheets to a static pack; the configuration chooses Sticker or Regular Emoji.
- `anim`: a frame sheet to one APNG, or configured groups of individual frame images to a complete pack; `--product emoji` selects a single Animated Regular Emoji, while configured packs derive the product from `package.product`.
- `prompt`: print a target-aware image-generation prompt from the configuration.
- `init`: write an annotated Sticker template by default or a Regular Emoji template with `--product emoji`.

`src/config/schema.ts` validates YAML or JSON with Zod. `src/config/load.ts` normalizes the result:

- `package.product` defaults to `sticker`; `product: emoji` requires `emojiSet: regular` in V1.
- `package.animated` or any `stickers[].frames` entry selects the animated form of the chosen product.
- Omitted background removal defaults to `true` for local sources and `false` for AI sources.
- Emoji output dimensions are exactly 180×180. Omitting `processing.maxSize` selects that value; an explicit different value is rejected.
- Animated Emoji defaults to a 300,000-byte limit and accepts only 5–20 frames, 1–4 loops, legal 1/2/3/4-second durations, and total playback no longer than four seconds.
- Omitted `animation.autoFit` defaults to `false` for Emoji and `true` for legacy Sticker configurations; an explicit value is preserved.
- Grid strings such as `4x2` become structured dimensions.

Paths inside the configuration resolve relative to the configuration file. Paths supplied as CLI arguments resolve relative to the current working directory. CLI `count` and `name` options take precedence over configuration values.

### Node image pipeline: `src/pipeline/`

The Node pipeline uses `sharp`, `@imgly/background-removal-node`, and `upng-js`.

- `removeBackground.ts` performs forced or residual-background-triggered semantic removal.
- `sheetAnalysis.ts` detects transparent, green, or opaque sheet backgrounds. Green backgrounds use deterministic chroma keying; opaque backgrounds use semantic removal.
- `fitCanvas.ts` trims or fits content according to requested bounds, margins, and even-dimension rules.
- `stroke.ts` and `text.ts` apply alpha-derived outlines and SVG text overlays.
- `pngFit.ts` reduces static PNG colors when needed.
- `stabilize.ts` aligns animation subjects using head or centroid anchors.
- `apng.ts` encodes APNG, rewrites `acTL.num_plays`, subsamples frames, and searches the configured color/frame quality ladder.
- `processStatic.ts` and `processAnimated.ts` compose those operations into the two primary pipelines.

`cropGrid.ts` is a lower-level grid cropper retained alongside the newer component-aware sheet extraction path.

### Packaging: `src/package/`

`buildMainTab.ts` derives fixed-size support assets. Sticker packs receive `main.png` plus `tab.png`,
and Animated Sticker packs receive an APNG main generated from the selected cover frames. Emoji calls
the tab-only helper; `tab.png` remains static and no Emoji main file is generated.

`buildZip.ts` writes sticker `main.png`, `tab.png`, and two-digit numbered files. `buildEmojiZip.ts` instead requires exactly one `tab.png` and the expected three-digit `001.png` onward, rejects missing, duplicate, or unexpected paths, and never accepts a `main.png`. Both create ZIPs from the current result only. They do not clean the output directory before writing, so stale files can remain beside the current package without entering the new ZIP.

### Browser application: `web/`

`web/src/App.tsx` exposes five React tabs: build, sheet, animation, video-to-APNG, and prompt. Regular Emoji is a target inside Build, Sheet, both ordinary Animation modes, Video, and Prompt rather than a sixth tab. The animation tab also contains a dedicated paired Pop-up Sticker mode. Every tab remains mounted while hidden so switching tabs preserves selected files and results. Big Sticker, Video, and Pop-up Sticker are browser-only; Video exports Animated Sticker, Animated Regular Emoji, or a paired Pop-up package derived from user-selected static frames. `#/colab-birefnet` is an independent tutorial page; opening it hides but does not unmount the workflow tabs.

`web/src/ui/` owns workflow state, logging, previews, downloads, validation display, and manual frame alignment. `SheetCutPreview.tsx` renders the Sheet tab's pre-process nominal grid without running background removal; the actual cutter may still snap its references to detected gutters. `VideoGridEditor.tsx` renders one large, zoomable representative video frame and edits the shared outer crop bounds plus internal separators in source-pixel coordinates before ingest. `PopupPackMode.tsx` owns the paired static/frame inputs and the browser-only Pop-up Sticker result. `ManualLayout.tsx` provides onion-skin alignment and applies user offsets before animation processing. `ColabBirefnetGuide.tsx` owns the tutorial and in-memory connection form; `colabBirefnetConnection.tsx` keeps the rotating endpoint and session key only for the current page lifetime and aborts active requests when the connection changes.

`web/src/webpipe/` mirrors the Node pipeline using browser primitives:

- RGBA raster objects and Canvas replace `sharp`.
- `fitCanvas.ts` supports an optional minimum transparent canvas for Big Sticker output while preserving proportional content and the existing regular-static defaults.
- `backgroundRemovalJob.ts` turns the five UI modes into one sequential, cancellable prepared-session contract. `preparedColorKey.ts` fits a robust border-color cluster, owns four-edge connectivity and trimap/RGB reconstruction, and gives preview and final rendering one immutable calibration identity. IMG.LY and local BiRefNet are dynamically loaded only for their respective modes; the Colab mode delegates to whichever single model the user's temporary Notebook session loaded.
- `foregroundCorrection.ts` owns the browser-local 8-bit Keep-mask algebra and premultiplied composition. `backgroundCorrection.ts` keeps source, automatic output, and correction separate so mask painting never reruns a remover. Browser workflows apply this layer before analysis, stabilization, fitting, stroke, text, or encoding; Sheet retains full-sheet coordinates before gutter/component analysis.
- `@imgly/background-removal` provides the self-hosted browser-local IMG.LY adapter. Its per-job progress callback avoids cross-talk between the always-mounted tabs.
- `sheetBackgroundRemoval.ts` applies semantic removal to overlapping nominal-cell crops, merges their alpha masks over the original RGB sheet, and then hands the full sheet to component-aware extraction.
- `upng-js` remains the APNG encoder. Final-byte APNG inspection supplies the strict timing, loop, frame, alpha, and distinct-visual evidence used by Popup Sticker validation.
- `zip.ts` emits sticker flat packs or the explicit Pop-up Sticker hierarchy. `emojiZip.ts` owns the independent main-less Regular Emoji manifest and final ZIP validation.
- `fflate` creates ZIP bytes for download.
- `videoSource.ts` uses Mediabunny plus WebCodecs to enumerate decoded presentation samples, normalize
  integer-microsecond intervals, apply display rotation/aspect metadata, and decode local frames.
- `rawVideoMaster.ts`, `masterApng.ts`, and `videoMasterStore.ts` stream unmodified crop visuals into
  bounded APNG containers backed by memory or IndexedDB while preserving a separate source-sample index.
- `processMasterApngSticker.ts`, `videoFrameRenderCache.ts`, and `videoProjectZip.ts` own deterministic
  exact-target rerenders, lazy background-removal caching, and strict versioned project archives.
- `colabBirefnet.ts` is the optional remote crop adapter. It accepts only an HTTPS
  `*.trycloudflare.com/remove` URL, disables redirects and credentials, bounds uploads and responses,
  validates a same-size grayscale PNG mask, and multiplies that mask into alpha locally.
- `localBirefnet.ts`, `localBirefnet.worker.ts`, and `localBirefnetContract.ts` implement the optional
  browser-local crop adapter. The client owns cancellation and worker lifetime; the worker lazy-loads
  a revision-pinned 512×512 fp16 model through Transformers.js, prefers WebGPU, falls back to WASM,
  processes requests serially, and multiplies the inferred mask with source alpha.

Vite aliases `@core` to the repository's `src/core/`, so the browser consumes the same specification, grid, cell, prompt, naming, and validation code. The build copies `@imgly/background-removal-data` into `dist/imgly/` and the Transformers.js-matched ONNX Runtime assets into `dist/transformers/`; `coi-serviceworker.js` supplies cross-origin isolation behavior on static hosting where custom headers are unavailable. The service worker rewrites navigation responses and cross-origin `no-cors` resources only; same-origin resources and CORS-authorized fetches bypass its response proxy so large model streams are not rewrapped. The IMG.LY medium resources total 88,188,479 bytes and are fetched only by the IMG.LY branch. The BiRefNet weight is fetched from a pinned Hugging Face revision only when the user starts local inference. Both use the browser cache.

`examples/colab/sticker-tool-birefnet-colab.ipynb` is the user-run compute adapter; its legacy filename and route remain for compatibility. Its checked-in generator pins code and weight revisions, ONNX adapter versions, and the Cloudflare Tunnel binary checksum. A registry normalizes each selected Torch or ONNX model to a same-size 8-bit mask and records its input policy, traits, and license note. The Notebook benchmarks the built-in scikit-image astronaut before accepting user work, starts a CORS-enabled FastAPI endpoint, and protects each POST with a per-run random session key.

## Data flows

### Static pack from individual images

```text
Natural-sort input files
  -> select requested count
  -> choose Regular Sticker, browser Big Sticker, or Regular Emoji product profile
  -> choose no removal, color key, IMG.LY, local BiRefNet, or Colab multi-model removal
  -> apply the selected remover before fitting
  -> trim and fit with transparent margin
  -> optional stroke
  -> optional text
  -> original-color PNG encoding
  -> Sticker/Big Sticker: derive main + tab and package two-digit files
  -> Emoji: derive tab only and package three-digit files
  -> validate collected metadata and ZIP size
  -> browser: offer an explicit color-reduction retry only for a byte-limit failure
```

The browser returns ZIP bytes for download instead of writing files. Its first pass does not silently
quantize pixels; optional reduction is a user decision after the package has been measured. The CLI's
older static pipeline retains its existing automatic byte-fitting behavior.

### Static pack from sprite sheets

```text
Count + character policy
  -> grid and sheet-count plan
  -> browser nominal cut guide before processing
  -> choose regular static, browser Big Sticker, or Regular Emoji output contract
  -> background detection/removal
  -> foreground row/column projections
  -> gutter planning and grid mismatch inference
  -> connected-component assignment to cells
  -> per-cell centering
  -> static image pipeline with the selected max/min canvas and margin policy
  -> target-specific support assets and ZIP
  -> kind-specific validation
```

The browser guide shows equal nominal cells and row-major numbering; it does not run a model or promise
the final pixel cut. Nominal cut lines are references rather than destructive boundaries. Custom grids
are rejected above 64 cells on either axis or 400 cells total before SVG cells or cutter work are
allocated. During processing, projection-derived gutters may move those references, and components are
assigned to a cell by position and copied whole. This prevents a hand or prop crossing a grid line from
being split or duplicated.

Regular static output keeps the existing 10-pixel transparent-margin policy and a 370×320 maximum.
Browser Big Sticker output from either individual images or sprite sheets uses no proactive display margin, proportional scaling, transparent padding
to at least 80×524, and a 396×660 maximum. Numbered output is forced to PNG color type 6 even after an
explicit color-reduction retry, and shared validation rejects missing or indexed final-byte evidence.
Big Sticker constants and metadata validation live in shared core; the current CLI configuration
adapter does not expose a Big Sticker workflow.

### Regular Emoji processing and packaging

Regular Emoji reuses acquisition, removal, cutting, fitting, stroke, text, and encoding adapters, but
uses a separate product profile at every contract boundary:

```text
8–40 image cells or 8–40 frame groups
  -> trim content; for animation compute one sequence-wide layout
  -> exact-fit every final item/frame to 180×180
  -> preserve truecolor RGBA delivery bytes
  -> animation: preserve all requested 5–20 frames
  -> encode PNG or APNG
  -> reopen final bytes and collect canvas/color/alpha/content evidence
  -> APNG: also collect frames/loops/duration/distinct-frame evidence
  -> build 96×74 tab from the selected cover
  -> validate `tab.png` + `001.png` onward; reject `main.png`
  -> enforce static `<20,000,000` or animated `≤20,000,000` ZIP boundary
```

Static items have a 1,000,000-byte limit. Animated items have a 300,000-byte limit, 1–4 loops, an
exact 1/2/3/4-second per-loop duration, and at most four seconds across all loops. Frame sheets and
configured frame groups reject counts outside 5–20 rather than subsampling them into the legal range.
All decoded frames cannot be identical.

Browser static Emoji first measures original-color output and exposes reduction only as a retry.
Browser Animated Emoji exposes an explicit original/256/128/64-color selection; original means no
quantization. The CLI follows `animation.autoFit` and its deterministic color ladder, reports reduction
in processing notes, and supports disabling the search. Emoji always passes `preserveFrames`, so byte
fitting cannot silently discard motion frames. Any result still over budget fails target validation.

The result model is discriminated: Sticker results require a main image, while Emoji results cannot
contain one and render 180×180 plus 32×32 previews. The four Emoji main-display choices are My Page
submission metadata, not a file generated by this repository.

The background-removal implementation differs by runtime:

- Node: transparency pass-through, green chroma key, or semantic removal for opaque sheets.
- Browser none/color-key: preserve alpha, or apply one of three explicit deterministic color-key paths. The safe default fits a dominant radial RGB cluster from visible border samples with robust spread, dominance, confidence, and outlier rejection, then selects compatible pixels four-way connected to the outer edge. Enclosed matching regions remain RGBA-identical, while enclosed background holes may remain. A narrow trimap solves alpha and foreground RGB against the learned background and despills only its unknown band; soft and hard alternatives remain explicit. The composed outer-edge-plus-whole-image path runs that connected treatment first and then hard-removes whole-image matches, while the standalone whole-image path skips connectivity. Both whole-image passes compare every pixel to one target RGB with Chebyshev tolerance from 0.0% through 20.0%; 0.0% means exact RGB only, and matching subject pixels are intentionally removed. None and semantic removers neither receive nor include color-key options in cache identity.
- Browser edge-connected color key scales its learned definite and transition thresholds with an independent `edgeToleranceScalePercent` from 0 through 200 in integer steps. Missing and 100 are equivalent to the existing learned automatic baseline; lower values narrow both thresholds and higher values widen them. The scale never broadens removal beyond four-way edge-connected matching pixels. Combined edge-plus-whole-image mode retains separate edge and 0.0–20.0% whole-image tolerances.
- Browser semantic modes: run IMG.LY, local BiRefNet, or the Colab multi-model remover over overlapping nominal-cell crops; merge alpha masks onto the original sheet; then run foreground projections and component-aware extraction. Overlap plus mask merging preserves subjects that cross nominal grid boundaries without sending a whole video frame to Colab.

### Animated sticker processing

Configured frame groups follow this sequence:

```text
Select target; Sticker normalizes the legacy frame range, Emoji requires 5–20 as supplied
  -> normalize and apply the selected background mode
  -> optional cross-frame subject stabilization
  -> independently exact-fit each frame to the same fixed canvas dimensions
  -> optional stroke and text
  -> encode APNG
  -> browser UI: preserve frames and reduce colors only when explicitly selected
  -> CLI legacy adapter: retain its configured quality ladder
  -> read APNG metadata back
```

The legacy Animated Sticker implementation treats `durationSec` as per-loop duration. It reduces that value
if `loops × duration` would exceed four seconds, including to fractional values, and encodes distributed
integer-millisecond delays. APNG loop count is explicitly rewritten to a finite value from 1 through 4.
LINE only allows 1, 2, 3, or 4 seconds per playback, so the regular adapter's fractional clamp remains a
known compliance gap. Animated Regular Emoji rejects invalid duration/loop combinations instead of
clamping and inspects decoded final duration, loops, frame count, distinct frames, and bytes. Popup mode
also avoids the legacy path by exposing only legal combinations and checking decoded final bytes.

A frame sheet first applies the selected sheet background mode, then goes through component-aware extraction with `align: "grid"`. Semantic modes use the same overlapping-crop alpha merge as static sheets. The current implementation performs scene alignment and then lower-body X/Y anchoring while constructing the common grid-relative cells. Subject-anchor stabilization in `processAnimated` is disabled afterward because applying another alignment system could move scene elements out of the canvas. Independent frame groups apply their selected remover after frame-count normalization and before stabilization and fitting, reusing one model job for the group. The browser offers manual onion-skin adjustment as an additional path. The lower-body anchoring can erase intentional whole-body movement such as jumping; see the implementation audit.

For complete Animated Sticker packs, the selected cover's fitted frames also generate animated
`main.png`; the first fitted cover frame generates static `tab.png`. Animated Regular Emoji uses only
the static `tab.png` and never generates an uploaded `main.png`.

### Pop-up Sticker processing

The browser-only third animation mode keeps LINE's static and full-screen assets explicit:

```text
8/16/24 static source images + one 5–20-frame sequence per item
  -> one shared, sequential background-removal job
  -> static sources: trim/fit without proactive margin -> numbered PNGs
  -> frame sequences: optional stabilization -> exact 480×480 fit -> truecolor APNG
  -> reopen every APNG and collect decoded timing/content evidence
  -> release that item's decoded/fitted RGBA frames before processing the next item
  -> derive main.png/tab.png from the selected static cover
  -> reuse the selected 480×480 cover APNG as main_popup.png
  -> strict paired-pack validation
  -> when over budget, offer an explicit truecolor color-reduction retry without reducing frames
  -> png/main.png + png/tab.png + png/NN.png
  -> popup/main_popup.png + popup/NN.png ZIP
```

The existing browser animated processor accepts explicit frame-count and total-duration limits; omitting
them preserves the regular Animated Sticker defaults. Pop-up Sticker mode passes the separate 5–20 frame,
1–3 loop, 1/2/3-second per-loop, and three-second total contract. A fixed 480×480 canvas is a deliberate
V1 subset of LINE's wider 480-sided geometry, not a claim that a square fills every phone screen. The
final-byte gate also rejects indexed PNG/APNG output and requires decoded transparency and visible
content. The initial package preserves source colors and merely reports 1 MB/60 MB failures; it never
uses palette or frame reduction as an automatic packaging side effect. Top/Center/Bottom display choice
remains submission metadata on LINE My Page and is not represented in the archive.

### Video sheet to editable APNG pack

The browser-only video workflow remains separate from the existing frame-sheet and frame-group animation tab:

```text
Local browser-decodable video
  -> Mediabunny probe + decoded presentation-frame index in integer microseconds
  -> choose one immutable project target: Animated Sticker, Animated Regular Emoji, or Pop-up Sticker
  -> explicit editable time window + one large start/middle/end/scrub-selectable grid editor
  -> choose any positive source-cell count and an equal-by-default, source-pixel shared grid
  -> optionally inset any outer crop bound or drag an internal separator
  -> sequentially decode every presentation sample intersecting the range
  -> apply the same fixed row-major grid and target-specific, aspect-preserving canvas plan to every sample
  -> deduplicate visual payloads without dropping any source timestamp/duration
  -> stream bounded lossless raw-master APNG chunks to memory/IndexedDB
  -> dispose the source decoder
  -> choose per-sticker range, hard 5-20 target, duration, loops, and background mode
  -> prepare one time-stratified removal session; preview and final share its calibration identity
  -> optionally compose source-coordinate Keep masks keyed by sticker/raw-visual identity
  -> expand deterministic time-uniform candidates as needed
  -> lazily transform only candidates; cache automatic model results separately from Keep composition
  -> coalesce adjacent equal final visuals and transfer their source duration backward
  -> allocate positive integer delays with an exact legal total
  -> use automatic color fitting by default, or explicitly preserve original colors / set a palette ceiling,
     without silently reducing the requested frame count
  -> reopen final APNG bytes and validate frames/delays/loops/alpha/content/bytes
  -> Popup: choose one final frame per item and fit it into the paired regular-static png/ track
  -> build a normal LINE ZIP only when every current render is valid and not dirty
  -> otherwise hard-stop missing bytes or explicitly label a confirmed invalid ZIP
  -> build the Sticker manifest, the main-less Emoji manifest, or the paired Popup png/ + popup/ manifest
  -> save/reopen a strict, checksummed Project ZIP V7 within its entry and expanded-byte budgets
```

V7 has no sampling-count control. `frameCoverage='all-presentation-frames'` means every decoded sample
intersecting the selected global range, not every compressed packet and not an FPS-derived estimate.
The source index is authoritative for time. Raw visual APNG delays are container details only; each
`sampleRef` carries its own clipped `timestampUs` and `durationUs` and points to a `visualFrameId`.
Visual deduplication therefore cannot collapse the editable timeline.

The correction UI presents a display-only projection of that timeline. Its raw-visual selector starts
collapsed while the active correction editor remains visible. Before a current render exists, it shows
only the deterministic time-uniform picks for the draft's target frame count; afterward it resolves the
render's final selected source indices, including deterministic replacements. Presentation samples that
share a `visualFrameId` produce one correction chip. The complete raw timeline remains authoritative for
calibration, copy-to-range corrections, duplicate/replacement processing, and project persistence.

Changing the source, columns, or rows restores the full-source equal grid; changing only the active output count,
time selection, product target, or background setting preserves them. The editor's derived
`VideoGridPlan.rects` drives preflight, every raw-master crop, and the Project ZIP V7 grid. Grid editing is
pre-ingest only because the source decoder is disposed after the raw master is baked and imported projects
do not embed the original video. Changing the output target frame count updates planned picks but does not
auto-fit clip lines.

The same decoded source sample feeds every crop before its `VideoSample` is closed. Ingest never removes
backgrounds. IMG.LY, local BiRefNet, and Colab multi-model removal run serially on the time-uniform target candidates.
Unused source frames are tried only as replacements when removal or quantization makes adjacent candidates identical, not merely because the encoded APNG exceeds its byte limit. None silently falls back to color keying. The Colab branch never sends a full source frame, source video,
audio, or project archive. Internal raw-master APNG chunks use lossless non-palette encoding, are not LINE
deliverables, and may exceed LINE delivery limits. Preflight reports actual source/crop counts and rejects
an estimated raw working set above the spike-backed 512 MiB beta budget.

Project ZIP V7 extends V6 with correction targets kept outside background settings, full current-render provenance, and cropped lossless Keep-mask assets under `corrections/assets/`. Targets bind `(stickerId, visualFrameId)` to exact source dimensions and a strong decoded-raster SHA-256; assets are content-addressed and deduplicated. It otherwise includes only declared manifest/report, `master/`, correction assets,
and current-render entries. Export
streams chunks into `fflate.Zip`; import bounds entry count and expanded bytes, rejects unsafe, duplicate,
missing, or undeclared paths, buffers one bounded raw entry at a time before writing it to the project store, checks SHA-256 and
decoded visual counts, verifies bounded correction geometry/content hashes, and verifies timeline correspondence across stickers. It excludes source video,
audio, secrets, automatic model results, and the optional model cache. V6 imports start with no corrections and invalidate obsolete color-key current renders; older migrations remain chained through V6. V1 imports are explicitly tagged
`sampled-legacy`/`baked-legacy` and do not synthesize missing samples or raw RGB.

The video source-cell count is deliberately separate from the LINE animated-pack count. Any positive
count within the selected grid may produce master chunks and adjusted APNGs; Project ZIP export additionally enforces its declared entry and expanded-byte safety budgets. Only the
LINE ZIP validation gate requires 8, 16, or 24 Animated Stickers or Pop-up Stickers, or 8 through 40 Animated Emoji.
Popup creates its required second track deterministically from the final frame selected by the user for
each item; the separate paired workflow remains for independently authored static artwork. Effect is
excluded because it still has no implemented product, project, validation, or upload-package contract.
Solid-color keying is disabled by default for Video. When selected, it defaults to four-way outer-edge
connectivity and decontamination. Its 0–200% edge tolerance scales the learned definite and transition
thresholds in 1% steps; 100% is the baseline/default, and missing values in older V7 projects resolve to
100%. Users may add a whole-image cleanup pass after the connected pass, opt
into standalone whole-image hard removal, or switch the connected edge treatment to soft or hard. Both
whole-image variants use an independent 0.0–20.0% tolerance in 0.1% steps and require preview inspection
because matching subject colors are intentionally removed.

### Prompt generation

Grid policy, style, identity constraints, background requirements, product target, and per-cell variations are composed by pure functions in `src/core/prompt.ts`. Emoji prompts emphasize inline readability, low margins, and meaningful first frames. The browser exposes both static-sheet and animation-frame prompts as copyable text. The current CLI `prompt` command still calls the static-sheet builder even for an animated configuration, although it retains the Emoji target. No artwork or network call is produced by this path.

## Validation and trust boundaries

The processing pipelines collect image metadata and pass it to shared pure validators. Validation covers
allowed pack counts, bounds, even dimensions, alpha/content evidence, byte limits, APNG frame/loop/delay
metadata, requested-target equality, adjacent decoded duplicates, main/tab evidence, and ZIP size when
the adapter supplies those fields. Regular Emoji, Video V6, and Pop-up Sticker mode supply evidence
reopened from final delivery bytes. Emoji package validation also requires the exact three-digit
manifest and rejects unexpected support files, including `main.png`.

Validation operates on metadata returned by the current pipeline. Emoji builders first validate their
expected manifest, while their item evidence is collected from each final encoded file before ZIP
assembly; this is not an independent second decode of every completed ZIP entry. Popup, Emoji, and
Video V6 adapters represent decoded duration in `ImageInfo`; older regular animation adapters may still
omit it.

Other older adapters do not yet reopen and audit every completed ZIP entry or populate every optional
pixel/timing field, so a successful report remains a diagnostic rather than proof of marketplace
acceptance. The source-grounded gaps and probes are tracked in
[plan/implementation-audit.md](plan/implementation-audit.md).

The application does not assess artistic quality, character identity, or marketplace policy beyond the encoded technical constraints. Grid warnings and extraction metrics are mechanical signals, not semantic review.

## Design decisions

### Keep generation outside the deterministic application

Image models are probabilistic and provider-specific. Separating generation from packaging lets users rerun fitting, text, compression, and validation without paying to regenerate artwork.

Project-local workflows under `.claude/skills/` coordinate character generation, pose references, animated sets, and LINE packaging, but they are not runtime dependencies of the CLI or web app. Their current animated handoff is not end-to-end: `anim-set` produces completed APNG files, while `anim --config` consumes lists of individual frame images. Any future workflow integration should define separate contracts for a frame image, frame sheet, and completed APNG.

### Share rules, not platform adapters

The specification, grid planning, cell extraction, prompts, and validators are shared. Pixel decoding, image transforms, font handling, file output, and downloads remain runtime-specific. This avoids leaking `Buffer`, filesystem, DOM, or Canvas types across the core boundary.

### Prefer component extraction over hard rectangular slicing

Generated sprite sheets frequently have uneven gutters or subjects that cross the ideal grid. Projection-derived gutters improve the reference grid, and connected components prevent those references from cutting through content.

### Use two distinct animation alignment strategies

Independent frame files may drift inside their canvases, so anchor stabilization aligns the subject before exact fitting. Frame sheets already encode a common grid coordinate system, so they skip the independent-frame anchor stabilizer. The current extraction path still performs its own scene and lower-body alignment; preserving intentional motion while removing generation drift remains an unresolved policy and implementation problem.

### Degrade deterministically to satisfy byte limits

Static images step down through color counts only when needed. Animated images search a deterministic ladder across color count and frame count according to the selected priority. If every allowed rung remains over budget, the best result is returned with an over-budget note and validation error.

Emoji narrows this policy. The browser never reduces colors unless the user requests a retry or selects
a color ceiling. The CLI defaults Emoji `animation.autoFit` to `false` and obeys an explicit opt-in;
legacy Sticker keeps its previous enabled default. Both keep truecolor delivery output and preserve the
requested animated Emoji frame count; an over-budget result remains a blocking error. The synthetic
[5/10/20-frame feasibility matrix](doc/emoji-apng-feasibility.md) found a measured path below 300 KB for
all low/high-motion cases, sometimes only at a 64-color ceiling. That is enough to retain UPNG for V1,
not evidence that reduced real artwork is visually acceptable or that browser bytes match Node bytes.

### Keep unverified marketplace behavior explicit

Regular Emoji V1 implements only the free-count Regular and Animated Regular contracts. Fixed
Kana/letter/number/symbol sequences require an ordered semantic-slot model and are not implemented.
Creators Market authentication, direct upload, and My Page automation are outside V1. Locally inspected
ZIPs and passing validators are diagnostic evidence; acceptance by the
current authenticated My Page flow has not been verified. PNG density can remain unknown and is emitted
as a warning rather than a passing claim. Artistic meaning, first-frame clarity, and marketplace review
remain human checks.

### Keep browser processing local by default

The web app has no application server and default workflows do not upload selected images or videos. Model and WASM assets are static deployment files fetched by the browser. GitHub Pages deployment is handled by `.github/workflows/deploy-pages.yml` for both `main` and `master`.

The optional IMG.LY and local BiRefNet branches keep pixels on-device but download model/runtime assets.
They are explicit choices rather than defaults. IMG.LY reports its approximately 84 MiB resource total;
BiRefNet distinguishes its 44.4M parameter count from its roughly 94 MiB fp16 file. Both warn that work
may be slow and that phones or tablets may run out of memory or fail to finish without blocking the attempt.

The optional Colab multi-model branch is an explicit network exception available to the browser image,
sheet, animation, and video adapters. Its stable boundary remains one PNG crop in and one same-size
grayscale alpha mask out. The Notebook adapts pinned BiRefNet, BEN2 Base, MODNet Portrait, IS-Net,
U²-Net, and gated custom-license RMBG 2.0 models behind that boundary, but keeps only one model resident.
Prompt-, trimap-, clean-plate-, and temporal-state models require separate workflows and are not exposed
as if they satisfied this contract. The user must run the benchmark, start the temporary API, paste its
URL and random session key, and confirm the estimated request count.
The connection exists only in React memory and is excluded from storage, URLs, logs, downloads, and
Project ZIP metadata. Colab and Cloudflare operate the temporary compute/tunnel; neither is a service
provided by this project, and neither has a runtime guarantee.

Changing models is a same-VM restart, not an in-flight hot swap: the user stops the final API cell,
changes `MODEL_CHOICE`, and runs all cells again. The Notebook shuts down the old tunnel and Uvicorn
thread, releases the old Torch or ONNX model, synchronizes CUDA, clears allocator caches, and then loads
one new adapter while retaining disk caches. Each run rotates the tunnel URL, session key, and runtime
generation. Reconfiguring the browser aborts active requests and invalidates Colab-derived Video caches
and current renders; credentials and generations are not persisted in Project ZIPs.

## Generated, local, and sensitive files

`dist/`, `web/dist/`, `out/`, evaluation runs, spikes, smoke outputs, and temporary artifacts are generated or local workspace data and should not be treated as source.

Secrets such as `.claude/openrouter.key` are ignored and must never be copied into documentation, logs, fixtures, or commits.

## Change guidance

- Put new LINE constants and platform-neutral rules in `src/core/`.
- Keep `src/core/` free of Node and browser APIs.
- When changing a platform-specific pipeline behavior, check whether the corresponding Node or browser implementation needs the same change.
- Consult `plan/implementation-audit.md` before changing validation, animation, sheet extraction, or optional workflow contracts.
- Update both long-lived documentation files when commands, boundaries, supported formats, or deployment behavior change.
- Verify CLI changes with the root typecheck/build and relevant tests.
- Verify shared-core or browser changes with both the root checks and `cd web && npm run build`.
- Use the browser smoke script only against a running preview server, as documented in `web/README.md`.
