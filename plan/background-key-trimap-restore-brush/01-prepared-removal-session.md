# 01 — Introduce the prepared removal session seam

**What to build:** Introduce an additive prepared-session boundary for browser background removal and prove it through the individual-image workflow. A source is calibrated once, preview and final output render through the same immutable session identity, and the current color-key result remains unchanged. Keep the legacy entry points temporarily so the repository stays green while later tickets migrate the remaining workflows.

**Blocked by:** None — can start immediately.

**Status:** complete

- [x] A prepared session accepts calibration input and exposes a stable identity, render result, automatic matte, and diagnostics.
- [x] The individual-image color-key preview and final output use the same prepared session rather than preparing removal independently.
- [x] Existing safe edge-connected fixtures remain byte-identical before and after this prefactor.
- [x] Existing whole-image color-code behavior and tolerance semantics remain unchanged.
- [x] Other browser workflows continue to compile and run through temporary compatibility entry points.
- [x] The background-removal contract proves session reuse and preview/final identity without testing private implementation helpers.
- [x] Browser typecheck, background-removal contract, and build pass.
