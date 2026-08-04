# Popup Sticker Support Plan

Status: completed and post-review safety corrections verified on 2026-08-04

## Post-review safety corrections

The follow-up review and product clarification changed these implementation details without changing
LINE's type-specific count allowlists:

- Static and Big Sticker packs accept 8/16/24/32/40; Animated and Pop-up Sticker packs accept
  8/16/24 according to their separate current Creators Market pages.
- Browser color reduction is opt-in. The first package preserves original colors, validates real bytes,
  and only an over-budget result offers a reduction retry.
- Big and Pop-up reduction candidates remain PNG color type 6; indexed output is never used to satisfy
  the byte limit.
- Pop-up color reduction preserves the selected frame count, and each item's fitted RGBA frames are
  cleared immediately after final APNG inspection instead of accumulating across the pack.
- Custom sheet grids are bounded before SVG cell allocation and before cutting.

## Goal

Add a browser workflow that turns explicit static sticker artwork plus per-sticker animation frames into a technically validated LINE Pop-up Sticker package.

The implementation targets the current official requirements published at:

- https://creator.line.me/en/guideline/popupsticker/
- https://creator.line.me/en/guideline/popupsticker/detail/
- [LINE's official production guide for folder/file placement](https://vos.line-scdn.net/lbstw-static/images/uploads/download_files/65a5b2ed44473162e8bf39c0f5c308eb/LINE%20%E4%BC%81%E6%A5%AD%E8%B4%8A%E5%8A%A9%E8%B2%BC%E5%9C%96_%E7%B4%A0%E6%9D%90%E8%A6%8F%E7%AF%84_202504.pdf)

The current CLI remains unchanged. The browser workflow is the requested product surface and already owns local frame processing, APNG encoding, previews, and downloads.

## Evidence ledger

### Observed from LINE's current pages

- A pack contains 8, 16, or 24 static sticker images and the same number of pop-up APNG images.
- Static sticker images are PNG files up to 370×320.
- Pop-up images are APNG files up to 480×480; one side must be exactly 480.
- When width is 480, height must be at least 320; when height is 480, width must be at least 200.
- `main.png` is a static 240×240 PNG, the pop-up main image is a 480×480 APNG, and `tab.png` is a static 96×74 PNG.
- Pop-up APNGs contain 5–20 frames, use 1–3 loops, use an integer 1/2/3-second per-loop duration, and must not exceed three seconds after multiplying duration by loops.
- Each image is at most 1 MB, the ZIP is at most 60 MB, the color space is RGB, and the background is transparent.
- LINE does not derive the static sticker from the APNG's first frame; the static and animated artwork are separate inputs.
- Top, Center, and Bottom display position is selected as submission metadata on LINE's page, not encoded into the image bytes described by the guideline.
- LINE adds margins to static sticker images but does not add margins to pop-up images or the pop-up main image.
- LINE's official production guide names the paired folders `png` and `popup`, keeps `main.png`/`tab.png`
  with the static set, keeps `main_popup.png` with the animated set, and explicitly rejects indexed color.

### Inferred implementation contract

- The package needs non-conflicting static and animated numbered files. Export `png/01.png…` with
  `png/main.png` and `png/tab.png`, and export `popup/01.png…` with `popup/main_popup.png`. This follows
  LINE's official production-guide folder and filename diagram.
- A fixed 480×480 pop-up canvas is within the allowed range and lets the selected cover APNG be reused byte-for-byte as `main_popup.png`.
- Static source files are batch-selected and natural-sorted; animation frames are selected per sticker and natural-sorted, matching the existing animated-pack workflow.

### Explicit assumptions

- V1 accepts individual animation frame images, not pre-encoded APNG files or one mega-sheet containing all stickers and all timelines.
- All stickers in one run share duration and loop settings. This is a valid subset of LINE's per-sticker possibilities.
- A technically valid report is still diagnostic and does not guarantee LINE's artistic/content review.

## Musk review

### Step 1 — Requirements challenge

| Requirement candidate | Decision | Concrete reason |
|---|---|---|
| Generate both static and pop-up assets | Keep | LINE explicitly defines two image sets; omitting either makes an 8/16/24-item package incomplete. |
| Add strict pop-up validation | Keep | 480-side geometry, 5–20 frames, 1–3 loops, and a three-second total differ from existing animated rules. |
| Add CLI support in the same change | Delete | The requested testing surface is the Vite web app, while Big Sticker is already browser-only; a second adapter would add commands/config without a named user flow. |
| Add a sixth top-level tab | Delete | `AnimTab` already owns frame-sheet and frame-group modes; one third mode keeps all APNG workflows under the existing tab. |
| Encode Top/Center/Bottom in the ZIP | Delete | LINE presents it as a submission-page choice; no image or ZIP field is specified on the supplied guideline. |
| Auto-create static stickers from frame 1 | Delete | LINE explicitly says the APNG first frame is not used as the static sticker; requiring explicit static inputs prevents a false promise. |
| Support arbitrary pop-up canvases immediately | Delete | 480×480 is valid for every item and can be reused as the required pop-up main image; custom portrait/landscape presets are not needed to prove packaging support. |
| Add provider calls or image generation | Delete | The repository's deterministic boundary excludes provider calls, and the user asked for post-processing/package support. |

### Step 2 — Scope deletion

- No new CLI command, config schema, provider integration, upload-to-LINE action, metadata form, prompt mode, or pre-encoded APNG importer.
- No second APNG encoder or duplicate static pipeline.
- No semantic content/moderation judgment; only observable technical requirements are enforced.
- No automatic fallback from invalid duration/loop combinations. The UI only presents valid combinations and validation rejects invalid metadata.

### Step 3 — Optimization

- Parameterize the existing browser animated processor with an explicit limits object; its default remains the regular Animated Sticker limits.
- Reuse `processStatic()` with zero proactive margin, `buildMainTab()` for the static cover, and the selected 480×480 cover APNG as `main_popup.png`.
- Add a dedicated `validatePopupPack()` instead of weakening the one-list `validatePack()` contract.
- Put the new React workflow in `PopupPackMode.tsx` and mount it as a third mode inside `AnimTab`.

## Architecture decisions

1. Shared specification and validation stay in `src/core/` and remain platform-neutral.
2. `StickerKind` gains `popup` only for shared count/bounds routing. Two-track package validation uses a dedicated typed function.
3. Browser APNG processing receives explicit limits for frame count and maximum total duration. Its UI
   honors `autoFit`: original-color output is the default, while an explicit reduction selection searches
   color candidates without reducing the chosen frame sequence.
4. Final PNG/APNG bytes expose their PNG color type, and final pop-up APNG bytes are reopened to collect frame count, loop count, exact duration, alpha/foreground evidence, and distinct-frame evidence before validation. Popup validation requires truecolor RGBA (PNG color type 6), not indexed palette output.
5. ZIP structure is explicit and tested:

   ```text
   png/main.png
   png/tab.png
   png/01.png …
   popup/main_popup.png
   popup/01.png …
   ```

6. The workflow uses 480×480 for every pop-up APNG in V1. This is a valid maximum canvas but does not claim to fill every device aspect ratio.

## Work items and ownership

### Goal A — Shared core rules and tests

Owner: core agent

Files owned:

- `src/core/spec.ts`
- `src/core/naming.ts`
- `src/core/validate.ts`
- `test/popupSticker.test.ts`
- `.gitignore`

Tasks:

1. Add `POPUP_STICKER_SPEC` and `POPUP_MAIN` constants with source provenance.
2. Add `popup` count/bounds routing without changing existing static, Big, or animated values.
3. Add popup archive naming constants/path helpers.
4. Implement strict `validatePopupImage()`, `validatePopupMain()`, and `validatePopupPack()`.
5. Test every geometry branch and exact min/max boundary, APNG/frame/loop/duration/RGBA color-type/alpha/content/byte failures, paired-list counts, main assets, ZIP limit, and regressions for existing kinds.

Acceptance:

- `npm run typecheck` passes.
- `npm test` includes focused popup tests and passes.

### Goal B — Browser processing evidence and ZIP package

Owner: browser-pipeline agent

Files owned:

- `web/src/webpipe/processAnimated.ts`
- `web/src/webpipe/apng.ts`
- `web/src/webpipe/png.ts`
- `web/src/webpipe/zip.ts`
- optional focused contract script under `web/scripts/` if needed

Tasks:

1. Add optional processing limits to `processAnimated()` while preserving regular defaults.
2. Add final-byte PNG/APNG color-type evidence and an APNG helper that reports exact decoded timing, loop, frame, alpha, foreground, distinct-frame, and adjacent-duplicate metadata.
3. Add `buildPopupPackZip()` with the planned archive paths and no extra diagnostic files.
4. Add a focused executable contract check for ZIP keys if browser smoke is not sufficient.

Acceptance:

- Existing animated output behavior is unchanged when limits are omitted.
- Popup limits can produce 480×480, 5–20-frame, 1–3-loop APNG metadata.
- The archive has exactly three grouped cover/tab assets plus matching `png/` and `popup/` numbered entries.

### Goal C — Browser workflow and end-to-end smoke

Owner: browser-UI agent

Files owned:

- `web/src/ui/PopupPackMode.tsx`
- `web/src/ui/AnimTab.tsx`
- `web/src/app.css`
- `web/scripts/smoke.mjs`

Tasks:

1. Add the third Animated APNG mode, `全螢幕貼圖整包`.
2. Require at least the selected 8/16/24 sorted static sources, warn and use the deterministic first
   selected count when extras exist, and require one 5–20-frame source set per item.
3. Expose only valid integer duration/loop combinations and show the exact technical limits plus the LINE display-position reminder.
4. Process pixels locally with the existing background-removal job, zero static margin, fixed 480×480 pop-up canvas, and cancellable sequential progress.
5. Render/download both asset sets and the three grouped cover/tab assets; run shared strict validation before presenting the package as valid.
6. Extend production-build smoke to create a complete eight-item package, observe validation success, check rendered APNG dimensions, download the ZIP, and assert its entry names.

Acceptance:

- The actual browser flow completes from uploaded fixtures to downloaded ZIP.
- The smoke test proves eight static and eight popup assets plus all three grouped cover/tab assets exist.
- Invalid/missing source sets do not create a valid-package result.

### Goal D — Primary integration, documentation, and review

Owner: primary agent

Files owned:

- `README.md`
- `web/README.md`
- `ARCHITECTURE.md`
- `web/src/App.tsx`
- this plan

Tasks:

1. Review every agent diff against the official requirements and original request.
2. Resolve integration/type errors without expanding scope.
3. Update user workflows, architecture boundaries, format table, web footer links, and web-only limitation.
4. Run unit/type/build checks and production browser smoke.
5. Refute the strongest failure hypotheses: wrong ZIP hierarchy, silent regular-animation regression, missing exact timing evidence, and non-APNG `main_popup.png`.

## Verification matrix

| Check | Expected observation |
|---|---|
| `npm run typecheck` | Shared/CLI TypeScript passes |
| `npm test` | Existing plus popup boundary tests pass |
| `npm run build` | Root bundle succeeds |
| `cd web && npm run typecheck` | Browser TypeScript passes |
| `cd web && npm run build` | Production Vite build succeeds |
| `node --check web/scripts/smoke.mjs` | Smoke script syntax passes |
| Vite preview + `node scripts/smoke.mjs` | Existing flows and the eight-item popup flow pass |
| Downloaded ZIP inspection | Exact planned paths; 8 static + 8 APNG + 3 grouped cover/tab assets |
| `git diff --check` | No whitespace errors |

## Completion criteria

- [x] Big Sticker commit exists independently before Popup Sticker work (`a53e7af`).
- [x] Shared Popup Sticker technical constants and strict validation are implemented and tested.
- [x] Browser workflow produces both required image sets and `main_popup.png`.
- [x] Generated ZIP hierarchy and count are observed from a real browser download.
- [x] Existing static, Big Sticker, animated, video, and prompt smoke paths still pass.
- [x] README, web README, architecture, footer, and this plan match the shipped behavior.
- [x] Primary agent has reviewed all delegated work and rerun final verification.

## Final verification evidence

- `npm run typecheck`: passed.
- `npm test`: 74 passed, 0 failed.
- `npm run build`: passed.
- `cd web && npm run typecheck`: passed.
- `cd web && npm run build`: passed with only the existing service-worker and ONNX `eval` warnings.
- `node --check web/scripts/smoke.mjs`: passed.
- Production preview + `node scripts/smoke.mjs http://localhost:4179/`: passed all existing flows and
  observed a valid eight-item Popup package with eight static PNGs, eight 480×480 APNGs, and exactly
  19 expected ZIP paths.
- Production preview + `node scripts/video-smoke.mjs http://localhost:4179/`: passed the complete Video
  V2 regression flow and final LINE ZIP validation.
- `git diff --check`: passed.

## Post-review verification evidence

- `npm run typecheck`, `npm test`, and `npm run build`: passed; 75 tests passed.
- `cd web && npm run typecheck` and `npm run build`: passed with only the existing service-worker and
  ONNX `eval` warnings.
- `cd web && npm run test:output-safety`: passed truecolor Big/Pop-up and opt-in reduction contracts,
  including an over-budget original-color pass and a frame-preserving quantized APNG candidate.
- Production browser smoke rejected `100000×100000` before allocating preview cells, observed eight Big
  Sticker outputs at PNG color type 6, and inspected all 19 Pop-up ZIP entries as PNG color type 6.
- The Pop-up loop explicitly clears each item's fitted frame array after final-byte inspection; only
  encoded bytes, compact metadata, and notes remain in the package result collection.
