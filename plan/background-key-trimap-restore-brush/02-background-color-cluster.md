# 02 — Remove sampled background color clusters conservatively

**What to build:** Upgrade the prepared safe color-key session to learn a robust dominant color cluster from source borders. The individual-image workflow removes nearby generated or compressed background shades together, retains the four-way outer-edge safety rule, reports calibration confidence, and lets the user correct the cluster center with the existing manual color control.

**Blocked by:** 01 — Introduce the prepared removal session seam.

**Status:** complete

- [x] Opaque border samples produce a deterministic dominant cluster with outlier rejection, robust spread, dominance, and confidence diagnostics.
- [x] The synthetic `#CF567B`/`#D1567B` background cluster is removed without manually increasing a global tolerance.
- [x] Per-channel minimum/maximum boxes are not used as the background model.
- [x] Only cluster-compatible pixels four-way connected to an outer edge are selected as automatic background.
- [x] Enclosed matching-color artwork and diagonal-only matching regions remain source-identical.
- [x] Transparent border pixels do not contaminate calibration and automatic alpha never exceeds source alpha.
- [x] Low-confidence or multimodal borders produce a visible warning and do not silently widen removal.
- [x] A manual background color creates a deterministic new calibration identity while retaining conservatively sampled variation.
- [x] The explicit whole-image color-code mode remains unchanged.
- [x] Preview, final output, contract tests, typecheck, and browser build pass with the new cluster model.
