# 09 — Retire legacy keying paths and verify the complete release

**What to build:** Complete the expand–contract migration after all workflows have adopted the prepared remover and correction layer. Remove obsolete direct keying routes, prove that every preview and exported artifact uses the same behavior, preserve the explicit whole-image contract, update user-facing documentation, and run the complete release verification including the reported pink-background case.

**Blocked by:** 05 — Apply restore editing before sheet analysis; 06 — Add frame correction to Animation and Pop-up workflows; 08 — Persist and validate Video correction masks.

**Status:** complete

- [x] Build, Sheet, Animation, Pop-up, and Video previews and final outputs all use the prepared background-removal boundary.
- [x] No UI component calls a retired low-level color-key implementation directly.
- [x] Temporary compatibility entry points from the expansion ticket are removed only after every caller has migrated.
- [x] The browser color-key remover version is bumped and obsolete current renders cannot be reused as current.
- [x] Existing whole-image color-code tolerance, warning, and destructive matching behavior remain explicitly tested and documented.
- [x] Restore controls have accessible names, keyboard-reachable actions, text status, and non-color-only edited-frame indicators across all workflows.
- [x] User documentation explains background cluster sampling, low-confidence warnings, trimap/despill, Restore Original versus Clear Correction, video copy semantics, and the impossibility of automatic recovery for indistinguishable connected pixels.
- [x] Architecture documentation records the prepared browser module, correction ordering, video identity/cache ownership, and project persistence boundary.
- [x] The reported pink-background class passes visual QA on checkerboard, black, and white without a visible pink perimeter or missing pink foreground lettering.
- [x] Root typecheck, tests, and build pass.
- [x] Browser background-removal, animation, Video, and project round-trip contracts pass along with browser typecheck and build.
- [x] Browser smoke checks pass when the required preview server, browser, and fixtures are available; any unavailable fixture or browser limitation is reported accurately.
- [x] No hosted background-removal call, API key, or new image upload path is introduced.

Visual evidence and decoded-color diagnostics for the reported Display P3 pink source are recorded in [visual-qa.md](visual-qa.md).
