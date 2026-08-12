# 07 — Add frame-scoped correction and shared calibration to Video

**What to build:** Add in-memory background calibration and foreground correction to Video editing. A draft uses one time-stratified background model, corrections attach to exact raw visual identities, repeated samples share the same edit, and users may explicitly copy a stationary correction to the current range while stale output is invalidated correctly.

**Blocked by:** 04 — Restore removed foreground with a reversible brush.

**Status:** complete

- [x] A video draft prepares one background model from up to three time-stratified raw visuals in its active range.
- [x] Every preview and final selected frame in that range uses the same calibration identity and does not recalibrate independently.
- [x] Corresponding edges remain stable across small frame-to-frame background-color variations within the agreed alpha tolerance.
- [x] Keep masks target raw visual identities; repeated presentation samples referencing one visual share one correction.
- [x] Users can navigate raw visuals and identify which visuals contain corrections.
- [x] “Apply to all current raw visuals” snapshots an explicit target set, accepts only matching dimensions, and clearly states that it is coordinate copying rather than tracking.
- [x] Range or target-frame expansion leaves newly included visuals unedited and marks the draft dirty.
- [x] Correction, calibration, or background-setting changes alter cache identity and invalidate the affected current render.
- [x] Unrelated sticker renders and unaffected raw-visual cache entries remain reusable.
- [x] The package path cannot treat a stale render as current after a correction change.
- [x] V1 contains no optical flow, object tracking, or automatic cross-frame propagation.
- [x] Video preview/final identity, cache invalidation, range-change, and frame-selection contracts pass with typecheck and browser build.
