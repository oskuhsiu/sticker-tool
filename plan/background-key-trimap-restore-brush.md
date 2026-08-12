# Browser Background Keying and Foreground Restore Brush Specification

- Status: implemented
- Date: 2026-08-12
- Scope: browser application only

## Problem Statement

The browser's deterministic solid-color remover currently represents the background with one RGB value and fixed distance thresholds. This is insufficient for generated images and video because a visually flat background is usually a cluster of nearby colors after antialiasing, generation, scaling, or compression. In the reported example, the nominal pink background is approximately `#CF567B`, but nearby border pixels include values such as `#D1567B`. Pixels on the white sticker outline are composites of foreground and that pink background, so changing alpha without reconstructing foreground RGB leaves a visible pink fringe.

Increasing one global tolerance is not a safe fix. It can remove pink lettering, detached decorations, fingers, hair, or other intended content. A zero-prompt semantic model has the opposite failure mode: it may preserve a common subject while discarding small text, punctuation, glows, or disconnected artwork that the user intended to keep.

The user needs two complementary protections:

1. A deterministic color-key pipeline that learns the actual background-color range, removes only background connected to the outer boundary, builds a trimap, and reconstructs contaminated edge RGB with despill.
2. A reversible foreground restore brush that lets the user recover any content removed by the automatic result without damaging the source or requiring another inference run.

The existing browser workflows also have multiple preview and render paths. If they call different color-key functions or prepare different background samples, the preview can disagree with the exported PNG/APNG. Video adds cache and project-persistence requirements: a manual correction must invalidate stale output, survive project export/import, and remain attached to the exact raw visual it was painted against.

## Solution

Build one browser-only prepared color-key engine and route every deterministic color-key preview and final render through it. A prepared session learns a robust background-color model from one still image or a time-stratified set of video calibration frames. That same immutable model is then reused for every frame covered by the session.

The safe edge-connected mode will:

1. Sample opaque border pixels and find the dominant background-color cluster with outlier rejection.
2. Calculate deterministic confidence and color-distance thresholds from that cluster rather than using per-channel minimum/maximum ranges.
3. Preserve the current four-way outer-edge flood-fill rule as the safety invariant.
4. Produce a three-state trimap: definite background, a narrow unknown transition band, and definite foreground.
5. Estimate alpha inside the unknown band and reconstruct foreground RGB against the learned local background.
6. Apply despill only inside the unknown band, never across confirmed foreground content.
7. Return the processed raster, automatic matte, prepared-model identity, and diagnostics from one shared render boundary.

The existing explicit whole-image color-code mode remains an opt-in destructive mode with its current binary tolerance contract. It is not silently converted to edge-connected behavior. The new restore layer may still be used to recover content from its result.

Add a remover-independent foreground correction layer after automatic background removal and before trim, fit, stroke, text, animation encoding, or packaging. The layer stores an 8-bit Keep mask separately from both the immutable source and immutable automatic result:

- A zero Keep value reproduces the automatic result exactly.
- A full Keep value restores the exact source RGBA pixel.
- Feathered values interpolate from the automatic result toward the source in premultiplied-alpha space.
- Clearing a correction returns that location to the automatic result; it does not paint additional transparency.

The user-facing primary tool is labelled as keeping or restoring original content. A separate “clear correction” action removes Keep paint. V1 does not include a force-background or erase-foreground brush.

For video, corrections are keyed to the existing raw visual identity. Repeated presentation samples that reference the same raw visual share one correction. A user may explicitly copy the current source-coordinate correction to all raw visuals currently in the draft range, but no mask is propagated automatically and changing the range does not silently apply it to new frames.

## User Stories

1. As a sticker creator, I want a visually flat generated background to be treated as a color range, so that small generator or compression variations are removed without manual tolerance hunting.

2. As a sticker creator, I want `#CF567B`, `#D1567B`, and nearby sampled pinks to be recognized as one background cluster, so that the reported pink perimeter does not remain.

3. As a sticker creator, I want only color-compatible regions connected to the image boundary to be automatically removed, so that enclosed same-color lettering and decorations remain intact.

4. As a sticker creator, I want diagonal-only contact not to count as background connectivity, so that the existing four-way safety behavior remains predictable.

5. As a sticker creator, I want antialiased outline pixels to receive a soft alpha and reconstructed foreground color, so that compositing on dark or light backgrounds does not reveal a colored halo.

6. As a sticker creator, I want spill removal limited to uncertain edge pixels, so that legitimate pink, green, or blue colors inside the subject are not neutralized.

7. As a sticker creator, I want existing source transparency to remain an upper bound on automatic alpha, so that color keying cannot make a previously translucent pixel more opaque.

8. As a sticker creator, I want untouched definite-foreground pixels to remain RGBA-identical to the source, so that background cleanup does not cause unrelated color drift.

9. As a sticker creator, I want to see the detected background color, confidence, and a warning for contaminated or non-uniform borders, so that I know when automatic sampling is unreliable.

10. As a sticker creator, I want low-confidence detection to remain conservative instead of automatically widening its tolerance, so that the tool fails visibly rather than deleting more content.

11. As a sticker creator, I want to use the existing eyedropper or color control to correct the background model, so that a foreground object touching the border does not permanently poison automatic sampling.

12. As a sticker creator, I want checkerboard, black, and white preview backgrounds, so that transparent gaps and colored fringes are visible before export.

13. As a sticker creator, I want the live preview and exported PNG/APNG to use the same prepared session, so that export cannot disagree with what I approved.

14. As a sticker creator, I want one Keep/Restore brush that paints original content back into the result, so that an accidentally removed letter, finger, decoration, or hair strand can be recovered.

15. As a sticker creator, I want a fully painted Keep pixel to restore the exact original RGBA value, so that manual correction is not another approximate matting operation.

16. As a sticker creator, I want a feathered brush edge, so that restored content blends smoothly into the automatic matte.

17. As a sticker creator, I want adjustable brush size and hardness, so that I can restore both small punctuation and larger regions efficiently.

18. As a sticker creator, I want zoom and pan while painting, so that corrections on small LINE sticker details are practical.

19. As a sticker creator, I want a visible correction overlay that can be toggled, so that I can distinguish manual Keep paint from automatic foreground.

20. As a sticker creator, I want undo and redo per completed brush stroke, so that imprecise edits are recoverable.

21. As a sticker creator, I want to clear the current stroke, the current frame's corrections, or all corrections only through explicit actions, so that I do not accidentally lose work.

22. As a sticker creator, I want clearing every correction to reproduce the automatic result byte-for-byte, so that the manual layer is demonstrably reversible.

23. As a sticker creator, I want changing background sampling or edge settings to recompute the automatic result while retaining compatible source-coordinate Keep paint, so that I can refine the key without repainting protected details.

24. As a sticker creator, I want replacing the source or changing its geometry to invalidate incompatible corrections rather than stretch them silently, so that a mask cannot be applied to the wrong pixels.

25. As a user of Build, Sheet, Animation, Pop-up, or Video workflows, I want the same color-key behavior and correction semantics, so that moving between workflows does not change the result.

26. As a sheet user, I want corrections applied to the full source sheet before component analysis and cutting, so that restored content participates in cell detection and is not trimmed away.

27. As an animation user, I want to navigate source frames and see which frames contain manual corrections, so that I can inspect the whole motion instead of only the first frame.

28. As a video user, I want each correction attached to the exact raw visual frame identity, so that duplicate presentation samples reuse the right correction and unrelated frames do not.

29. As a video user, I want the same learned background model reused across the draft range, so that small frame-to-frame background variations do not create alpha flicker.

30. As a video user, I want an explicit “apply this correction to all current raw visuals” action, so that stationary artwork can be corrected quickly when I accept the coordinate-based trade-off.

31. As a video user, I want that bulk action to list or summarize its exact target frame set before applying, so that it never implies motion tracking.

32. As a video user, I want new frames introduced by a range change to remain unedited and mark the draft dirty, so that corrections are not silently extrapolated.

33. As a video user, I want edited frames marked in the timeline or frame selector, so that I can find unreviewed or manually corrected frames.

34. As a video user, I want any correction change to invalidate the affected cache entry and current rendered output, so that stale APNG bytes cannot be packaged.

35. As a video user, I want corrections to survive Project ZIP export and import, so that I can resume a detailed cleanup session later.

36. As a video user, I want identical correction assets deduplicated in the project, so that an explicit apply-to-all operation does not multiply archive size unnecessarily.

37. As a user importing an older project, I want it to load with an empty correction set and a clear rerender requirement for outdated color-key output, so that migration is safe and understandable.

38. As a security-conscious user, I want malformed, oversized, mismatched, or undeclared correction masks rejected during import, so that project archives cannot allocate unbounded memory or alter the wrong frame.

39. As a privacy-conscious user, I want deterministic keying and manual correction to remain entirely in the browser, so that this feature does not upload images or add an API dependency.

40. As a keyboard or assistive-technology user, I want labelled tools, buttons, frame selectors, status text, and non-color-only edit indicators, so that the correction workflow is operable without relying solely on the canvas colors.

## Implementation Decisions

### Architecture and ownership

- Implement one deep browser color-key module that owns background calibration, connectivity, trimap construction, alpha solving, RGB reconstruction, despill, and diagnostics.
- Keep serializable setting and project-contract types in the platform-neutral shared core. Keep pixel buffers, Canvas interaction, sampling, matting, mask encoding, and brush rendering in the browser adapter.
- The sheet analyzer delegates background removal to the prepared engine; it no longer owns a second color-key implementation.
- Preview components do not call low-level chroma-key functions directly. They request output from the same prepared session contract used by the final render.
- The existing background-removal job remains the mode adapter. It prepares or receives the appropriate automatic remover, then passes the automatic result through the common correction layer.
- The correction layer applies to every automatic removal mode except `none`, including semantic removers. This lets users recover source content even when a model—not only color keying—deleted it.
- No image-generation provider or hosted removal call is added.

### Background calibration

- A still image prepares a session from that source. A video draft prepares one session from up to three time-stratified raw visuals in the active range and reuses it for preview and final rendering across that range.
- Sample opaque or meaningfully visible pixels from the full outer border. Exclude transparent samples and reject statistical outliers before fitting the dominant cluster.
- Represent the background as a dominant cluster with a centroid, robust spread, inlier thresholds, dominance ratio, and deterministic confidence. Do not represent it as independent per-channel minima and maxima because that admits colors never observed together.
- A manually selected background color overrides the cluster center while sampled variation still informs a conservative spread. The user can reset to automatic calibration.
- Calibration identity includes the algorithm version, selected settings, manual color if any, and hashes of the calibration rasters. It participates in preview/render reuse and cache identity.
- If the dominant cluster is weak or border samples are highly multimodal, emit a low-confidence diagnostic. Do not compensate by silently expanding the removal range.

### Connectivity and trimap

- Four-way flood fill from all four outer edges remains the safe-mode topology rule.
- Definite background consists of high-confidence background-cluster pixels reachable from an outer-edge seed.
- The unknown region consists of connected lower-confidence background candidates plus a narrow inward band around the definite-background/foreground boundary. The inward band is necessary to include antialiased pixels whose RGB is no longer close to the pure background.
- Definite foreground is everything outside the unknown/definite-background regions. A Keep correction can only move the final result toward the immutable source; it never expands automatic background selection.
- Existing transparent alpha is respected throughout. Automatic output alpha may stay equal or decrease but never exceed source alpha.
- The explicit whole-image color-code mode keeps its documented hard, global matching semantics and tolerance range. Its contract is tested separately from safe edge-connected mode.

### Edge alpha, foreground RGB, and despill

- For pixels in the unknown band, estimate local background from the prepared cluster and nearby definite-background samples.
- Estimate foreground color from nearby definite-foreground evidence, then solve the standard compositing relation between observed color, foreground, background, and alpha. Use a bounded least-squares or equivalent deterministic solution and clamp unstable low-alpha cases.
- Reconstruct RGB in the unknown band instead of changing alpha alone. When alpha is too small for stable inverse compositing, inherit a bounded nearby foreground estimate rather than amplifying channel noise.
- Despill only the residual learned-background component in unknown pixels. Never apply global hue suppression to confirmed foreground.
- Preserve source RGBA byte-for-byte outside the automatically changed region and outside manual correction footprints.
- The default edge-connected “decontaminate” option uses trimap, reconstruction, and despill. Existing soft and hard diagnostic alternatives remain available unless a later product decision removes them explicitly.

### Foreground correction model

- Maintain three separate values: immutable source RGBA, immutable automatic result/matte, and an editable 8-bit Keep mask.
- Interpret the Keep mask as correction strength. Compose from automatic result toward source in premultiplied-alpha space: zero is the exact automatic result, full strength is exact source RGBA, and intermediate values form a feathered transition.
- Painting increases Keep strength within the brush footprint. “Clear correction” decreases it toward zero. It does not set foreground alpha to zero and is not a background-erasing brush.
- The brush editor never writes into source RGB or the automatic matte. Recomputing the automatic result therefore cannot destroy manual edit history.
- Apply correction before foreground bounds, trimming, fitting, stabilization, stroke, text, APNG encoding, and packaging.
- One completed pointer-down/move/up gesture is one undoable stroke. Undo/redo stores bounded mask-tile diffs rather than complete image snapshots.
- Brush coordinates are source-raster coordinates. View zoom, pan, device pixel ratio, and CSS scaling must not change which source pixels are edited.
- All-zero masks are omitted. Non-empty masks are cropped to their non-zero bounds and stored as lossless 8-bit assets with source geometry and content hash.

### User interface

- Show the correction editor only after an automatic result exists and only when a removal mode other than `none` is active.
- Provide Keep/Restore Original, Clear Correction, brush size, hardness, zoom, pan, overlay toggle, undo, redo, clear-current, and clear-all controls.
- Use unambiguous copy: “Restore Original” restores source content; “Clear Correction” returns to automatic removal. Do not label the latter simply “Erase.”
- Preview transparency on checkerboard by default and allow black and white backgrounds for fringe inspection.
- Display calibration color, confidence, warnings, current frame identity, edit presence, and stale/current render state in text as well as visually.
- Require confirmation only for destructive clear-all actions or explicit bulk application to many frames; ordinary paint, undo, and redo remain immediate.

### Workflow and video behavior

- In sheet workflows, edit the full source raster before grid analysis and component extraction.
- In individual-image workflows, correction belongs to that source image.
- In frame-sequence workflows, correction belongs to each source raster identity. Coordinate copying across equal-size frames is explicit.
- In video, correction targets the raw visual identity rather than presentation-sample index. Repeated samples that point to the same visual therefore share one mask.
- “Apply to all current raw visuals” snapshots an explicit target-ID set and reuses the same source-coordinate mask asset only when dimensions match. It warns that it is not motion tracking.
- Range or target-frame changes do not extend old bulk edits to newly included visuals. New visuals are unedited, and the affected draft becomes dirty.
- V1 does not use optical flow, object tracking, or semantic propagation. Those methods may preserve background when a foreground object moves, so they require a separate design and evaluation.

### Cache, render state, and project persistence

- Cache identity includes automatic-remover version, calibration identity, background settings, correction-set hash, source hash, and raw visual identity.
- Any change to calibration, automatic-removal settings, or correction masks invalidates affected preview/cache/current render entries. Unrelated sticker renders remain reusable.
- Bump the browser color-key remover version. Previously rendered color-key output is not treated as current under the new edge algorithm.
- Bump the video project schema when persistence lands (V6 to V7 if no intervening migration exists).
- Persist correction targets separately from background-mode settings so switching removal modes can ignore without destroying compatible edits.
- Project manifests reference content-addressed, lossless mask assets with raw visual ID, source dimensions, source content hash, crop bounds, byte length, and checksum. Identical masks are stored once and may be referenced by multiple visuals.
- Older projects import with an empty correction set. Existing raw masters remain reusable, while color-key current renders whose remover provenance is obsolete are invalidated and require rerendering.
- Import rejects unknown visual IDs, duplicate conflicting targets, source-hash mismatch, geometry mismatch, malformed masks, undeclared assets, checksum mismatch, excessive decoded pixels, excessive edit count, and excessive aggregate mask bytes.

### Determinism and performance

- The same inputs, settings, calibration set, and correction masks must produce byte-identical automatic mattes and corrected rasters on the same supported browser pipeline.
- Background preparation is performed once per still or video draft session, not independently for every preview call or video frame.
- Reuse prepared calibration and automatic results until their identity changes. Painting a mask must not rerun a semantic model or redownload assets.
- Brush interaction updates only dirty mask tiles and the visible preview region where practical; it must not re-encode an APNG while the pointer moves.
- Diagnostics may measure changed/background/unknown pixel counts, but must not retain full duplicate rasters after the owning job is disposed.

## Testing Decisions

- The highest-value test seam is the prepared-session render contract exercised through the existing browser background-removal contract. Tests assert external raster, matte, diagnostics, and correction behavior rather than private clustering helpers.
- Build one deterministic synthetic fixture containing a `#CF567B`/`#D1567B` border cluster, compressed near-background variations, a white antialiased outline, an enclosed same-pink decoration, a disconnected foreground element, original transparency, and a deliberately removed detail that Keep paint must restore.
- Assert that edge-connected cluster pixels become transparent without manual tolerance changes.
- Assert that the enclosed matching-color decoration and disconnected non-background content remain source-identical.
- Assert that diagonal-only matching pixels are not treated as four-way connected background.
- Assert automatic alpha never exceeds source alpha and definite foreground remains source-identical.
- Validate reconstructed edges in two complementary ways: recompositing over the learned background closely reproduces the source composite, and compositing over black and white produces a neutral outline without measurable pink chroma above the agreed fixture threshold.
- Assert despill changes only unknown-band pixels and never changes confirmed foreground pink content.
- Run the same foreground against several small background-color variations in one prepared video session and assert corresponding automatic alpha values do not flicker beyond a small numeric tolerance.
- Test low-confidence, multimodal borders: diagnostics warn, thresholds remain conservative, and manual background selection produces a deterministic new session identity.
- Test Keep-mask endpoints and feathering: zero yields exact automatic bytes; full strength yields exact source RGBA; intermediate values produce the expected premultiplied transition and never lower automatic alpha.
- Test brush coordinate mapping at multiple zoom, pan, CSS-size, and device-pixel-ratio combinations. Only pixels inside the intended feathered source-space footprint may change.
- Test stroke undo/redo, clear-current, clear-all, and clearing back to exact automatic bytes.
- Test correction application before trim by restoring a small feature outside the automatic foreground bounds and asserting it appears in the final fitted output.
- Add one browser workflow integration test proving preview and final export call the same prepared engine identity. Cover at least one still/sheet path and one Video-to-APNG path.
- Extend the video project round-trip contract to verify mask asset deduplication, target mapping, source geometry/hash, checksums, project migration, and exact edit restoration.
- Assert any correction edit changes cache identity and invalidates the affected current render while leaving unrelated renders current.
- Assert range expansion does not add corrections to newly included visual IDs and marks the draft dirty.
- Assert malformed dimensions, unknown frame IDs, hash mismatch, undeclared assets, decompression-limit violations, and oversized aggregate masks fail closed during project import.
- Preserve existing whole-image color-code tests to prove its explicit destructive behavior has not been silently changed.
- Run proportional repository verification: root typecheck/tests/build, browser background-removal and video-project contracts, browser typecheck/build, and the browser smoke test when its preview server and fixtures are available.
- Perform visual QA on the reported pink-background example over checkerboard, black, and white. This complements numeric fixtures but does not replace them.

## Acceptance Criteria

- The sampled `#CF567B`/`#D1567B` background cluster is removed in safe edge-connected mode without manually raising a global tolerance.
- The white outline in the reported class of input has no visible pink perimeter when composited on checkerboard, black, or white.
- Foreground pink lettering and decorations that are not connected to outer background remain unchanged.
- Definite foreground outside the trimap and manual edit footprint remains RGBA-identical to source.
- Preview and final PNG/APNG use the same prepared model identity and produce matching per-frame removal results.
- A full-strength Keep stroke restores exact source RGBA; clearing it restores exact automatic output.
- Undo/redo and mask clearing are deterministic and never mutate source pixels.
- Video corrections attach to explicit raw visual IDs, persist through project round-trip, and never spread to new frames implicitly.
- Editing a correction invalidates stale cache/current output, and the package builder cannot consume that stale render as current.
- Old projects import safely with empty corrections and explicit rerender requirements where remover provenance changed.
- The feature remains browser-local and introduces no hosted API call or secret.
- When automatic evidence cannot distinguish same-color foreground from background, the UI exposes the limitation and the Keep/Restore workflow resolves it without promising automatic perfection.

## Out of Scope

- A guarantee that any zero-prompt algorithm or model preserves every arbitrary content element.
- Changes to the Node/CLI removal pipeline or CLI/browser parity in this iteration.
- Replacing IMG.LY, BiRefNet, or Colab with another semantic background-removal provider.
- Adding hosted removal APIs, accounts, billing, API keys, or image uploads.
- A force-background, remove-foreground, or transparency-painting brush.
- Automatic removal of enclosed background holes; a future background-region click or remove brush may address that separately.
- GrabCut, SAM, ViTMatte, clean-plate matting, optical flow, object tracking, or automatic cross-frame mask propagation.
- Redesigning the explicit whole-image color-code mode or silently changing its tolerance semantics.
- Generating a second clean-background render or obtaining upstream alpha/mask layers from an image/video provider.
- Persisting non-video sessions where the product currently has no project archive.
- Changes to LINE specification validation, package naming, animation timing, frame selection, compression, or alignment.

## Further Notes

- This feature addresses two different problems in sequence: automatic topology/matting determines a conservative first result; the Keep mask records user intent where pixels alone are ambiguous. Neither should be presented as a substitute for the other.
- A foreground pixel that is identical to the background and connected to it without a detectable boundary is not recoverable from one composite image automatically. The restore brush is the required escape hatch for that case.
- Preserve the existing distinction between individual-frame stabilization and frame-sheet grid alignment. Manual background corrections occur before either behavior and must not become a new alignment signal.
- Implementation should proceed in four reviewable stages: prepared engine and golden contract; shared correction layer and brush editor; still/sheet/animation integration; video identity, cache, and project persistence.
- User-facing commands and component boundaries introduced by implementation require corresponding README and architecture updates. Validation or animation contract changes are not authorized by this specification.
- Background-generation guidance remains: prefer a uniform `#00FF00` background when the foreground contains no green, otherwise use `#0000FF`; never choose a key color already prominent in the intended artwork. Better source separation reduces corrections but does not replace edge reconstruction.
