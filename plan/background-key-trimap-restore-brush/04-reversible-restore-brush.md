# 04 — Restore removed foreground with a reversible brush

**What to build:** Add a complete foreground correction experience to the individual-image workflow. After any automatic remover runs, the user can paint original content back with a feathered Keep/Restore brush, inspect the result at useful zoom levels, undo mistakes, and clear corrections without mutating either the source or automatic result.

**Blocked by:** 03 — Reconstruct trimap edges and eliminate color spill.

**Status:** complete

- [x] The correction model keeps immutable source RGBA, immutable automatic output, and an independent 8-bit Keep mask.
- [x] Zero Keep strength reproduces exact automatic bytes and full strength restores exact source RGBA.
- [x] Intermediate Keep strength blends toward source in premultiplied-alpha space without lowering automatic alpha.
- [x] The correction layer works with color key, IMG.LY, local BiRefNet, and Colab removal, and remains hidden for `none`.
- [x] The editor provides Restore Original, Clear Correction, brush size, hardness, zoom, pan, correction overlay, undo, redo, clear-current, and clear-all controls.
- [x] Tool names and status are accessible in text and do not depend only on canvas color.
- [x] Source-coordinate painting remains accurate across zoom, pan, CSS scaling, and device pixel ratio.
- [x] One completed pointer gesture is one undoable stroke, and clearing all corrections returns exact automatic bytes.
- [x] Correction is applied before foreground bounds, trim, fit, stroke, text, and package output.
- [x] Replacing the source or changing its geometry invalidates an incompatible mask instead of stretching it.
- [x] Painting does not rerun a semantic model or re-encode animation output while the pointer moves.
- [x] Individual-image preview and exported PNG reflect the same corrected raster.
- [x] Brush, coordinate, reversibility, workflow contract, typecheck, and browser build checks pass.
