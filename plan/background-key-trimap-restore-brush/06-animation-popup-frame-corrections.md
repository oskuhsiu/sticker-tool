# 06 — Add frame correction to Animation and Pop-up workflows

**What to build:** Extend the prepared remover and correction editor to browser Animation and non-Video Pop-up inputs. Users can inspect and restore individual source frames, see which frames have edits, and explicitly copy a correction between equal-size frames without implying automatic motion tracking.

**Blocked by:** 04 — Restore removed foreground with a reversible brush.

**Status:** complete

- [x] Each animation or Pop-up source raster owns correction state by stable source identity rather than visible list position alone.
- [x] Users can navigate frames and identify edited frames through text or icons in addition to color overlays.
- [x] Preview and final APNG/static paired output apply corrections before stabilization, fitting, stroke, text, and encoding.
- [x] Frame-sheet correction remains separate from individual-frame stabilization and grid alignment behavior.
- [x] Copying a mask to other frames is explicit, lists or summarizes the target set, and requires matching source dimensions.
- [x] No correction is automatically propagated to a new or changed frame.
- [x] Clearing a frame correction returns that frame to its exact automatic result without affecting other frames.
- [x] The editor works with every automatic removal mode and does not rerun a semantic model for mask-only edits.
- [x] Existing animation timing, frame count, alignment, compression, and Pop-up pairing contracts remain unchanged.
- [x] Animation/Pop-up integration tests, typecheck, browser build, and relevant smoke coverage pass.
