# Architecture

Last verified against the source tree on 2026-08-04.

## Purpose and boundaries

`sticker-tool` is a deterministic post-processing and packaging system for LINE sticker assets. It accepts local images, sprite sheets, or animation frames and produces regular static PNG, browser Big Sticker PNG, regular animated APNG, or paired browser Pop-up Sticker packages plus metadata-based validation results.

The system deliberately does not call an AI image-generation API. Artwork can come from any external tool. The prompt builder and project-local skills help create suitable inputs, while the application owns repeatable image processing, packaging, and LINE-spec checks.

## System overview

```text
Local images ───────────────┐
External image generator ───┼──> CLI or browser workflow
Prompt builder ─────────────┘             │
                                          ├──> shared core decisions and validation
                                          ├──> platform-specific image pipeline
                                          └──> main/tab/numbered files + ZIP or download
```

There are two runtime surfaces:

1. The Node.js CLI, bundled as one ESM entry point while keeping native and third-party dependencies external.
2. A Vite/React static web app, deployed to GitHub Pages and executed in the browser. Its image workflows share five explicit background modes: none, solid-color keying, browser-local IMG.LY, browser-local BiRefNet, and BiRefNet through a temporary Google Colab session started by the user.

Both surfaces import `src/core/` directly. They intentionally have separate image I/O implementations because Node uses `sharp` and `Buffer`, while the browser uses Canvas-compatible RGBA arrays and `Uint8Array`.

## Repository structure

### Shared core: `src/core/`

The shared core contains no Node filesystem or browser DOM dependencies.

- `spec.ts` defines LINE regular-static, Big Sticker, animated, Pop-up Sticker, count, byte, frame, loop, main, tab, and ZIP limits.
- `types.ts` defines normalized configuration and pipeline contracts.
- `validate.ts` validates image metadata and complete package metadata.
- `grid.ts` plans sprite-sheet dimensions and enforces character-sheet quality thresholds.
- `sheet.ts` infers grid dimensions and finds low-occupancy gutter bands from foreground projections.
- `cells.ts` performs connected-component assignment, preserves content that crosses nominal grid lines, and lays cells out for static or animated use.
- `prompt.ts` builds static-sheet and animation-frame prompts without invoking a model. Both prompt
  types include background-removal-safe text guidance: unrequested text is prohibited, while requested
  lettering and symbols are rendered as opaque foreground artwork connected to the main subject.
- `naming.ts` and `color.ts` provide deterministic naming and color parsing helpers.

This directory is the compatibility boundary between the CLI and web app. Shared behavioral changes should be implemented here when they do not require platform APIs.

### CLI and configuration: `src/cli/`, `src/config/`

`src/cli/index.ts` registers five Commander commands:

- `build`: individual local images to a static pack.
- `gen`: one or more existing sprite sheets to a static pack.
- `anim`: a frame sheet to one APNG, or configured groups of individual frame images to a complete animated pack.
- `prompt`: print an image-generation prompt.
- `init`: write an annotated example configuration.

`src/config/schema.ts` validates YAML or JSON with Zod. `src/config/load.ts` normalizes the result:

- `package.animated` or any `stickers[].frames` entry selects animated mode.
- Omitted background removal defaults to `true` for local sources and `false` for AI sources.
- Omitted maximum dimensions use the selected sticker kind's LINE limits.
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

`buildMainTab.ts` derives fixed-size main and tab assets. Animated packs receive an APNG `main.png` generated from the selected cover frames; `tab.png` remains static.

`buildZip.ts` writes `main.png`, `tab.png`, and zero-padded numbered files, then creates a ZIP containing exactly those files. It does not clean the output directory before writing, so stale files can remain beside the current package without entering the new ZIP.

### Browser application: `web/`

`web/src/App.tsx` exposes five React tabs: build, sheet, animation, video-to-APNG, and prompt. The animation tab contains frame-sheet, regular animated-pack, and paired Pop-up Sticker modes. Every tab remains mounted while hidden so switching tabs preserves selected files and results. The video and Pop-up Sticker modes are browser-only and do not add CLI commands. `#/colab-birefnet` is an independent tutorial page; opening it hides but does not unmount the workflow tabs.

`web/src/ui/` owns workflow state, logging, previews, downloads, validation display, and manual frame alignment. `SheetCutPreview.tsx` renders the Sheet tab's pre-process nominal grid without running background removal; the actual cutter may still snap its references to detected gutters. `PopupPackMode.tsx` owns the paired static/frame inputs and the browser-only Pop-up Sticker result. `ManualLayout.tsx` provides onion-skin alignment and applies user offsets before animation processing. `ColabBirefnetGuide.tsx` owns the tutorial and in-memory connection form; `colabBirefnetConnection.tsx` keeps the rotating endpoint and session key only for the current page lifetime and aborts active requests when the connection changes.

`web/src/webpipe/` mirrors the Node pipeline using browser primitives:

- RGBA raster objects and Canvas replace `sharp`.
- `fitCanvas.ts` supports an optional minimum transparent canvas for Big Sticker output while preserving proportional content and the existing regular-static defaults.
- `backgroundRemovalJob.ts` turns the five UI modes into one sequential, cancellable job contract. IMG.LY and local BiRefNet are dynamically loaded only for their respective modes; Colab is available only for BiRefNet.
- `@imgly/background-removal` provides the self-hosted browser-local IMG.LY adapter. Its per-job progress callback avoids cross-talk between the always-mounted tabs.
- `sheetBackgroundRemoval.ts` applies semantic removal to overlapping nominal-cell crops, merges their alpha masks over the original RGB sheet, and then hands the full sheet to component-aware extraction.
- `upng-js` remains the APNG encoder. Final-byte APNG inspection supplies the strict timing, loop, frame, alpha, and distinct-visual evidence used by Popup Sticker validation.
- `zip.ts` emits the usual flat packs or the explicit Pop-up Sticker hierarchy: static cover/tab and numbered files under `png/`, with the animated cover and numbered files under `popup/`.
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

Vite aliases `@core` to the repository's `src/core/`, so the browser consumes the same specification, grid, cell, prompt, naming, and validation code. The build copies `@imgly/background-removal-data` into `dist/imgly/` and the Transformers.js-matched ONNX Runtime assets into `dist/transformers/`; `coi-serviceworker.js` supplies cross-origin isolation behavior on static hosting where custom headers are unavailable. The IMG.LY medium resources total 88,188,479 bytes and are fetched only by the IMG.LY branch. The BiRefNet weight is fetched from a pinned Hugging Face revision only when the user starts local inference. Both use the browser cache.

`examples/colab/sticker-tool-birefnet-colab.ipynb` is the user-run compute adapter. Its checked-in generator pins BiRefNet model revisions and the Cloudflare Tunnel binary checksum. The Notebook provides lite/full fixed-square inference and dynamic aspect-preserving inference capped by the selected maximum edge and rounded to multiples of 32. It benchmarks the built-in scikit-image astronaut before accepting user work, starts a CORS-enabled FastAPI endpoint, and protects each POST with a per-runtime random session key.

## Data flows

### Static pack from individual images

```text
Natural-sort input files
  -> select requested count
  -> choose no removal, color key, IMG.LY, local BiRefNet, or Colab BiRefNet
  -> apply the selected remover before fitting
  -> trim and fit with transparent margin
  -> optional stroke
  -> optional text
  -> PNG byte-budget fitting
  -> derive main and tab from the selected cover
  -> package numbered files
  -> validate collected metadata and ZIP size
```

The browser performs the same logical sequence, but returns ZIP bytes for download instead of writing files.

### Static pack from sprite sheets

```text
Count + character policy
  -> grid and sheet-count plan
  -> browser nominal cut guide before processing
  -> choose regular static or browser Big Sticker output contract
  -> background detection/removal
  -> foreground row/column projections
  -> gutter planning and grid mismatch inference
  -> connected-component assignment to cells
  -> per-cell centering
  -> static image pipeline with the selected max/min canvas and margin policy
  -> main/tab/ZIP
  -> kind-specific validation
```

The browser guide shows equal nominal cells and row-major numbering; it does not run a model or promise the final pixel cut. Nominal cut lines are references rather than destructive boundaries. During processing, projection-derived gutters may move those references, and components are assigned to a cell by position and copied whole. This prevents a hand or prop crossing a grid line from being split or duplicated.

Regular static output keeps the existing 10-pixel transparent-margin policy and a 370×320 maximum.
Browser Big Sticker output uses no proactive display margin, proportional scaling, transparent padding
to at least 80×524, and a 396×660 maximum. Big Sticker constants and metadata validation live in shared
core; the current CLI configuration adapter does not expose a Big Sticker workflow.

The background-removal implementation differs by runtime:

- Node: transparency pass-through, green chroma key, or semantic removal for opaque sheets.
- Browser none/color-key: preserve alpha or key a detected/user-selected solid color before extraction.
- Browser semantic modes: run IMG.LY, local BiRefNet, or Colab BiRefNet over overlapping nominal-cell crops; merge alpha masks onto the original sheet; then run foreground projections and component-aware extraction. Overlap plus mask merging preserves subjects that cross nominal grid boundaries without sending a whole video frame to Colab.

### Animated sticker processing

Configured frame groups follow this sequence:

```text
Load at least 5 frames and subsample above 20
  -> normalize and apply the selected background mode
  -> optional cross-frame subject stabilization
  -> independently exact-fit each frame to the same fixed canvas dimensions
  -> optional stroke and text
  -> encode APNG
  -> reduce colors and, if necessary, frames along a quality ladder
  -> read APNG metadata back
```

The regular animation implementation treats `durationSec` as per-loop duration. It reduces that value
if `loops × duration` would exceed four seconds, including to fractional values, and encodes distributed
integer-millisecond delays. APNG loop count is explicitly rewritten to a finite value from 1 through 4.
LINE only allows 1, 2, 3, or 4 seconds per playback, so the regular adapter's fractional clamp remains a
known compliance gap. Popup mode avoids that path by exposing only legal duration/loop combinations and
checking exact decoded duration from final bytes.

A frame sheet first applies the selected sheet background mode, then goes through component-aware extraction with `align: "grid"`. Semantic modes use the same overlapping-crop alpha merge as static sheets. The current implementation performs scene alignment and then lower-body X/Y anchoring while constructing the common grid-relative cells. Subject-anchor stabilization in `processAnimated` is disabled afterward because applying another alignment system could move scene elements out of the canvas. Independent frame groups apply their selected remover after frame-count normalization and before stabilization and fitting, reusing one model job for the group. The browser offers manual onion-skin adjustment as an additional path. The lower-body anchoring can erase intentional whole-body movement such as jumping; see the implementation audit.

For complete animated packs, the selected cover's fitted frames also generate animated `main.png`; the first fitted cover frame generates static `tab.png`.

### Pop-up Sticker processing

The browser-only third animation mode keeps LINE's static and full-screen assets explicit:

```text
8/16/24 static source images + one 5–20-frame sequence per item
  -> one shared, sequential background-removal job
  -> static sources: trim/fit without proactive margin -> numbered PNGs
  -> frame sequences: optional stabilization -> exact 480×480 fit -> APNG
  -> reopen every APNG and collect decoded timing/content evidence
  -> derive main.png/tab.png from the selected static cover
  -> reuse the selected 480×480 cover APNG as main_popup.png
  -> strict paired-pack validation
  -> png/main.png + png/tab.png + png/NN.png
  -> popup/main_popup.png + popup/NN.png ZIP
```

The existing browser animated processor accepts explicit frame-count and total-duration limits; omitting
them preserves the regular Animated Sticker defaults. Pop-up Sticker mode passes the separate 5–20 frame,
1–3 loop, 1/2/3-second per-loop, and three-second total contract. A fixed 480×480 canvas is a deliberate
V1 subset of LINE's wider 480-sided geometry, not a claim that a square fills every phone screen. The
final-byte gate also rejects indexed PNG/APNG output and requires decoded transparency and visible
content. Top/Center/Bottom display choice remains submission metadata on LINE My Page and is not
represented in the archive.

### Video sheet to editable APNG pack

The browser-only video workflow remains separate from the existing frame-sheet and frame-group animation tab:

```text
Local browser-decodable video
  -> Mediabunny probe + decoded presentation-frame index in integer microseconds
  -> explicit editable time window + start/middle/end/scrub grid previews
  -> choose any positive source-cell count and fixed grid
  -> sequentially decode every presentation sample intersecting the range
  -> apply the same fixed row-major grid and LINE canvas plan to every sample
  -> deduplicate visual payloads without dropping any source timestamp/duration
  -> stream bounded lossless raw-master APNG chunks to memory/IndexedDB
  -> dispose the source decoder
  -> choose per-sticker range, hard 5-20 target, duration, loops, and background mode
  -> expand deterministic time-uniform candidates as needed
  -> lazily transform only candidates; cache model results in a bounded session LRU
  -> coalesce adjacent equal final visuals and transfer their source duration backward
  -> allocate positive integer delays with an exact legal total
  -> search colors without silently reducing the requested frame count
  -> reopen final APNG bytes and validate frames/delays/loops/alpha/content/bytes
  -> build a normal LINE ZIP only when every current render is valid and not dirty
  -> otherwise hard-stop missing bytes or explicitly label a confirmed invalid ZIP
  -> save/reopen a strict, checksummed Project ZIP V2 at any time
```

V2 has no sampling-count control. `frameCoverage='all-presentation-frames'` means every decoded sample
intersecting the selected global range, not every compressed packet and not an FPS-derived estimate.
The source index is authoritative for time. Raw visual APNG delays are container details only; each
`sampleRef` carries its own clipped `timestampUs` and `durationUs` and points to a `visualFrameId`.
Visual deduplication therefore cannot collapse the editable timeline.

The same decoded source sample feeds every crop before its `VideoSample` is closed. Ingest never removes
backgrounds. IMG.LY, local BiRefNet, and Colab BiRefNet run serially only on selected render candidates;
none silently falls back to color keying. The Colab branch never sends a full source frame, source video,
audio, or project archive. Internal raw-master APNG chunks use lossless non-palette encoding, are not LINE
deliverables, and may exceed LINE delivery limits. Preflight reports actual source/crop counts and rejects
an estimated raw working set above the spike-backed 512 MiB beta budget.

Project ZIP V2 includes only declared manifest/report, `master/`, and current-render entries. Export
streams chunks into `fflate.Zip`; import bounds entry count and expanded bytes, rejects unsafe, duplicate,
missing, or undeclared paths, streams raw chunks directly into the project store, checks SHA-256 and
decoded visual counts, and verifies timeline correspondence across stickers. It excludes source video,
audio, secrets, and the optional model cache. V1 imports are explicitly tagged
`sampled-legacy`/`baked-legacy` and do not synthesize missing samples or raw RGB.

The video source-cell count is deliberately separate from the LINE animated-pack count. Any positive
count within the selected grid can produce master chunks, adjusted APNGs, and a Project ZIP. Only the
LINE ZIP validation gate requires 8, 16, or 24 stickers. Solid-color keying is disabled by default
because it cannot distinguish a flat background from matching subject details.

### Prompt generation

Grid policy, style, identity constraints, background requirements, and per-cell variations are composed by pure functions in `src/core/prompt.ts`. The browser exposes both static-sheet and animation-frame prompts as copyable text. The current CLI `prompt` command always calls the static-sheet builder, even for an animated configuration. No artwork or network call is produced by this path.

## Validation and trust boundaries

The processing pipelines collect image metadata and pass it to shared pure validators. Validation covers
allowed pack counts, bounds, even dimensions, alpha/content evidence, byte limits, APNG frame/loop/delay
metadata, requested-target equality, adjacent decoded duplicates, main/tab evidence, and ZIP size when
the adapter supplies those fields. Video V2 and Pop-up Sticker mode supply evidence reopened from final
delivery bytes.

Validation operates on metadata returned by the current pipeline; it does not reopen and audit every file
from the completed ZIP. Popup and Video V2 adapters represent decoded duration in `ImageInfo`; older
regular animation adapters may still omit it.

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

### Keep browser processing local by default

The web app has no application server and default workflows do not upload selected images or videos. Model and WASM assets are static deployment files fetched by the browser. GitHub Pages deployment is handled by `.github/workflows/deploy-pages.yml` for both `main` and `master`.

The optional IMG.LY and local BiRefNet branches keep pixels on-device but download model/runtime assets.
They are explicit choices rather than defaults. IMG.LY reports its approximately 84 MiB resource total;
BiRefNet distinguishes its 44.4M parameter count from its roughly 94 MiB fp16 file. Both warn that work
may be slow and that phones or tablets may run out of memory or fail to finish without blocking the attempt.

The optional Colab BiRefNet branch is an explicit network exception available to the browser image,
sheet, animation, and video adapters. The user must run the Notebook benchmark, start the temporary API,
paste its URL and random session key, and confirm the estimated request count.
The connection exists only in React memory and is excluded from storage, URLs, logs, downloads, and
Project ZIP metadata. Colab and Cloudflare operate the temporary compute/tunnel; neither is a service
provided by this project, and neither has a runtime guarantee.

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
