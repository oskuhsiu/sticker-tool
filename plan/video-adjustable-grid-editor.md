# Video Adjustable Grid Editor Plan

Status: implemented and verified on 2026-08-05

## Problem and observed implementation gap

The Video -> APNG source step currently divides every decoded display frame into equal rectangles. This
fails for sources whose visual cells have unequal widths or heights: a fixed equal separator can include
content from the neighboring sticker for every frame in the project.

The screenshot that triggered this work matches `VideoCutRangeStep.tsx`, including the `01.png` style
labels and its four small start/middle/end/custom previews. The older Video plan already specified
draggable grid lines in `plan/video-to-apng-plan.md`, but the current implementation still calls
`planVideoGrid()` with only `cols`, `rows`, and `count`.

The processing seam is already suitable for unequal cells:

```text
equal or edited axis cuts
  -> VideoGridPlan.rects
  -> preview overlay + preflight estimate
  -> rawVideoMaster fixed crop on every presentation frame
  -> project.grid in Project ZIP V3
```

`rawVideoMaster.ts` crops from `VideoGridPlan.rects`, and Project ZIP V3 already serializes those rects.
The missing work is therefore cut geometry, editor UI, and state wiring; it does not require a new media
pipeline or project schema.

## Pre-work requirements review

### Step 1 - Challenge the requirements

- **Established - adjustable internal grid lines.** In the supplied 4x2 case, an equal vertical line
  intersects a neighboring cell's artwork. Without an editable boundary, every presentation frame is
  ingested with the same wrong crop.
- **Established - a large editing surface.** The current four-up layout uses columns as narrow as 180 px;
  the supplied rendered preview is approximately 426x209 px, which is not precise enough for boundary
  placement.
- **Established - one fixed layout for the whole video.** `rawVideoMaster.ts` deliberately applies the
  same `VideoGridPlan.rects` to every presentation frame to avoid crop jitter.
- **Deleted from V1 - automatic content/gutter detection.** Four representative frames do not prove a
  gutter remains empty across the complete video, and semantic removal intentionally happens after
  ingest. An automatic line chosen from one sampled frame could cut moving content in another frame.
- **Deleted from V1 - draggable outer bounds.** The reported failure is an internal separator; changing
  outer bounds introduces unused source margins and a second crop coordinate system without evidence it
  is needed.
- **Deleted from V1 - independent, overlapping, reorderable, or disabled rectangles.** These were in the
  aspirational Video plan, but they require explicit overlap/gap/order semantics and are not needed for
  the demonstrated shared 4x2 layout.
- **Deleted from V1 - Sprite sheet and Animated frame-sheet integration.** Those workflows use
  component-aware extraction and animation alignment contracts that are different from Video's fixed
  rectangular crops.
- **Deleted from V1 - persistent editor preferences or a project version bump.** The existing V3 grid
  already stores explicit rectangles. Editing is pre-ingest only; imported projects already contain
  baked raw masters and do not need the source editor.

### Step 2 - Delete implementation surface

- Replace the four simultaneous editable previews with one full-width editor and four small semantic
  selector buttons. All four time points remain inspectable without shrinking the working image.
- Keep source-frame pixel coordinates throughout; do not add normalized, CSS-pixel, or percentage
  geometry to the project format.
- Add no package, image model, worker, persistence layer, or new project manifest field.
- Keep endpoints fixed at `(0, 0)` and `(sourceWidth, sourceHeight)`; only the `cols - 1` vertical and
  `rows - 1` horizontal separators are editable.

### Step 3 - Optimize the remaining design

- Reuse `VideoGridPlan` as the one geometry contract consumed by preview, estimation, ingest, and ZIP.
- Reuse the pointer capture, rendered-to-source coordinate conversion, arrow-key nudge, and Shift x10
  conventions already used by `ManualLayout.tsx`.
- Keep equal division as the deterministic default and expose one `Restore equal split` action.

## V1 interaction contract

1. Loading a video creates equal source-pixel cuts.
2. The source step displays one selected start/middle/end/custom frame in a full-width editor.
3. The editor defaults to fit width and offers fit, 150%, and 200% display zoom. Zoom changes only CSS
   display size; crop values remain integer source pixels. The viewport scrolls when zoomed.
4. Internal separators have a visible line plus a wider invisible pointer hit target.
5. Pointer drag moves one separator and clamps it strictly between its neighbors, leaving at least one
   source pixel in each cell.
6. A focused vertical separator responds to Left/Right; a horizontal separator responds to Up/Down.
   One keypress moves one source pixel and Shift moves ten. Each handle exposes separator orientation,
   current value, and legal range to assistive technology.
7. All preview cell rectangles and row-major output labels update immediately.
8. `Restore equal split` resets both axes exactly. Changing the source video, column count, or row count
   also resets to equal cuts; changing only output count keeps the current guides.
9. The edited grid drives memory preflight, raw-master cropping for every presentation frame, and the
   `project.grid` written to Project ZIP V3. Manual positions are final fixed boundaries and are not
   silently snapped afterward.
10. After raw-master ingest, the existing source editor disappears with the source step. Imported V1/V2/V3
    projects remain read-only with respect to source crop geometry because their raw master is already
    baked.

## Implementation tasks and ownership

### Task A - Pure grid geometry contract

- **Owner:** core geometry agent
- **Files:** `src/core/videoCrop.ts`, `test/videoCrop.test.ts`, and the grid assertions in
  `web/scripts/video-project-roundtrip.mts`
- **Work:**
  - Add a source-pixel axis-cut type/helper for equal cuts.
  - Add a pure internal-guide move helper with integer rounding, strict index validation, and
    neighbor clamping.
  - Let `planVideoGrid()` accept validated explicit X/Y cuts while preserving its current equal default.
  - Require exact array lengths, `0`/source-size endpoints, safe integers, and strictly increasing cuts.
  - Prove unequal cuts produce gap-free, non-overlapping row-major rects and survive Project V3
    round-trip unchanged.
- **Dependencies:** none.

### Task B - Large accessible video grid editor and state wiring

- **Owner:** browser UI agent
- **Files:** `web/src/ui/video/VideoGridEditor.tsx` (new),
  `web/src/ui/video/VideoCutRangeStep.tsx`, `web/src/ui/video/VideoSourceStep.tsx`,
  `web/src/ui/VideoTab.tsx`, `web/src/app.css`, and `web/scripts/video-smoke.mjs`
- **Work:**
  - Store edited cuts in `VideoTab` before ingest and build the single derived `VideoGridPlan` from them.
  - Add the full-width selected-time editor, fit/150%/200% zoom, scrollable viewport, pointer drag,
    keyboard controls, accessible separator metadata, current pixel status, and equal reset.
  - Preserve start/middle/end/custom frame inspection through selector buttons.
  - Clear edited cuts when video/cols/rows change and keep them when only `count`, time range, target, or
    background settings change.
  - Disable source-grid inputs and handles during ingest so the displayed geometry cannot diverge from
    the plan captured by `buildMaster()`.
  - Extend the Video browser smoke to exercise a scaled pointer move, exact keyboard nudge, reset,
    overlay/image alignment, large rendered work area, raw-master creation, and the edited rects in the
    downloaded Project manifest.
- **Dependencies:** Task A's exported geometry API.

### Task C - Primary-agent review, documentation, and final verification

- **Owner:** primary agent
- **Files:** agent diffs plus `README.md`, `ARCHITECTURE.md`, `web/README.md`, and the status text in
  `plan/video-to-apng-plan.md`
- **Work:**
  - Review every changed line against this V1 boundary and reject cosmetic-only grid state.
  - Confirm preview, preflight, ingest, and Project ZIP all consume the same plan.
  - Confirm no source/grid change can leave stale explicit cuts active.
  - Update long-lived user and architecture documentation.
  - Independently inspect the resulting UI and the Project manifest after an edited-grid ingest.
- **Dependencies:** Tasks A and B.

## Verification strategy

Focused automated checks:

- `npm test -- --test-name-pattern='Video grid'` if supported, otherwise `npm test`.
- `cd web && npm run test:video`.
- `cd web && npm run typecheck`.
- A built-preview `web/scripts/video-smoke.mjs` run in Chrome.

Repository checks required by `AGENTS.md`:

- `npm run typecheck`
- `npm test`
- `npm run build`
- `cd web && npm run build`

Browser acceptance evidence:

- At a desktop viewport, the active editing image occupies the source card's available width instead of
  one quarter of it.
- At 200% zoom, the editor viewport scrolls and the SVG remains aligned to the rendered image.
- Pointer dragging at a scaled display size and keyboard nudging both change source-pixel rect geometry.
- Reset restores exact equal cuts.
- Building a raw master and downloading Project ZIP V3 preserves the edited rectangle values.
- A narrow viewport has no page-level horizontal overflow; zoom overflow stays inside the editor
  viewport.

## Completion criteria

- The supplied class of unequal 4x2 video sheet can be corrected before ingest without editing source
  media.
- The editable frame is materially larger than the current four-up preview and supports deliberate zoom.
- The editor is not cosmetic: the exact geometry visible before ingest is the geometry used by every raw
  presentation-frame crop and stored in the project manifest.
- Equal-grid behavior remains byte-for-byte geometry-compatible for users who do not move a guide.
- Existing V1/V2/V3 Project imports still pass.
- No automatic content inference, outer crop, independent rectangle, or non-Video workflow is claimed as
  implemented.
