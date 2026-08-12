# 03 — Reconstruct trimap edges and eliminate color spill

**What to build:** Turn the safe color-key transition into a true trimap-based matte. Antialiased pixels near connected background receive a solved alpha, reconstructed foreground RGB, and narrowly scoped despill so that outlines no longer carry the generated background color when viewed over transparent, black, or white backgrounds.

**Blocked by:** 02 — Remove sampled background color clusters conservatively.

**Status:** complete

- [x] Safe edge-connected rendering distinguishes definite background, a narrow unknown band, and definite foreground.
- [x] The unknown band reaches inward far enough to include antialiased composite pixels that are no longer close to pure background.
- [x] Unknown pixels solve bounded alpha and foreground RGB against learned local background evidence.
- [x] Numerically unstable low-alpha pixels use a bounded nearby foreground estimate rather than amplified channel noise.
- [x] Despill changes only unknown-band pixels and does not suppress legitimate matching colors in confirmed foreground.
- [x] Definite foreground outside the automatic change region remains source RGBA-identical.
- [x] Automatic alpha stays at or below source alpha.
- [x] Recompositing the synthetic edge over the learned background closely reproduces its source composite.
- [x] Compositing the white outline fixture over black and white stays within the agreed neutral-chroma threshold and shows no pink halo in visual QA.
- [x] Preview and final output use the same trimap result and prepared session identity.
- [x] Existing soft, hard, and whole-image diagnostic alternatives retain their documented behavior.
- [x] Background-removal contracts, typecheck, browser build, and pink-fixture visual verification pass.
