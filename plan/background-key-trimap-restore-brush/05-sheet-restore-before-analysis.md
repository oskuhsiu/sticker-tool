# 05 — Apply restore editing before sheet analysis

**What to build:** Bring the prepared remover and foreground correction editor to the Sheet workflow at the correct semantic boundary. The user edits the full source sheet before gutter planning and component extraction, so restored text, limbs, decorations, and other small regions participate in cell detection and survive final cutting.

**Blocked by:** 04 — Restore removed foreground with a reversible brush.

**Status:** complete

- [x] The full source sheet is calibrated and corrected before foreground profiles, gutter planning, grid inference, and component extraction.
- [x] Sheet preview and final cell extraction use the same prepared session and corrected source raster.
- [x] A feature restored outside the automatic foreground bounds changes component analysis and appears in the correct final cell.
- [x] Components crossing nominal grid lines remain whole and are not duplicated or split by the correction integration.
- [x] The editor works for every automatic removal mode and is hidden for `none`.
- [x] Keep masks stay in source-sheet coordinates and are invalidated when source identity or geometry changes.
- [x] Existing grid-mismatch warnings, alignment semantics, and whole-image color-code behavior remain intact.
- [x] Sheet-level background-removal and component extraction contracts cover restored and untouched content.
- [x] Browser typecheck, build, and relevant smoke coverage pass.
