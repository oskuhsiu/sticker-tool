# Reported pink-background visual QA

Date: 2026-08-12

## Source and setup

- Source: `截圖 2026-08-12 上午9.05.57.png`, 598×502.
- Source SHA-256: `be08fd5dfb7fa3a50f6ad3d231b6ca4e2a1abb27546d4b4554c75395bee8e448`.
- The file carries a Display P3 profile. Browser-equivalent decoding produced a dominant border center of RGB `(191, 94, 122)` even though an encoded-color inspection reports the familiar `#CF567B`/nearby pink family.
- Mode: automatic border sampling, outer-edge connected scope, decontaminate edge.
- Calibration: confidence `0.9746`, dominance `0.9959`, robust spread `1.712`, 2,196 visible border samples, no warnings.
- Render diagnostics: 96,684 definite-background pixels, 14,116 trimap unknown pixels, and 110,564 changed pixels.

## Views inspected

- Checkerboard at 100% and 200%: pass. The solid pink perimeter is gone; the white sticker outline remains smoothly antialiased and the pink lettering/decorations remain present.
- Black at 100%: pass. No visible pink key-color rim; reconstructed light and dark edge pixels remain appropriate over black.
- White at 100% and 200%: pass. No visible pink key-color rim; the retained white outline blends into the white plate as expected.

The local QA composites remain temporary evaluation output and are not source assets. Deterministic contracts retain the reproducible evidence: clustered pink border variants, enclosed matching-color preservation, black/white recomposition, spatially varying local-background alpha, and a color-managed neutral edge whose red channel crosses the sampled plate color.

## Known boundary

The connected color key deliberately preserves disconnected or enclosed matching-color content. It can therefore leave an enclosed background hole, and no raster-only automatic method can distinguish a foreground pixel that is identical to a connected background pixel. The Keep/Restore brush is the explicit correction path for those ambiguous cases.
