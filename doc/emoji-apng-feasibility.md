# 180×180 Animated Emoji APNG Feasibility

Measured on 2026-08-04 (Asia/Taipei). This document records a synthetic,
local compression experiment. It does not claim that LINE My Page accepted
the generated files, and it does not substitute for testing representative
finished artwork.

## Outcome

The current Node processor and UPNG encoder have a measured path below the
project's `300,000`-byte Animated Regular Emoji item limit for both synthetic
artworks at 5, 10, and 20 frames, without dropping frames and without emitting
indexed-color PNGs. However, that path is not always the original-color path:

- the low-motion 20-frame original-color result was `335,560` bytes and failed;
- every high-motion original-color result failed, from `301,199` bytes at five
  frames to `1,188,788` bytes at 20 frames;
- a 256-color ceiling passed five of six frame/artwork combinations but the
  high-motion 20-frame result remained `453,641` bytes;
- a 128-color ceiling also failed that case at `348,080` bytes;
- a 64-color ceiling passed all six combinations; the largest was the
  high-motion 20-frame result at `270,745` bytes.

Therefore, no additional codec dependency is justified by these synthetic
measurements alone. The product still needs the existing blocking over-budget
result and explicit color-reduction choice. The experiment does **not** show
that 64 colors are visually acceptable for real artwork.

## What was measured

The temporary deterministic measurement program was
`/tmp/emoji-apng-feasibility.mts` (327 lines, SHA-256
`e12244a745d917b74cedf8d4e1d4e592a1025f4ebe18431cf11de2b8b221722e`).
It generated every source frame in memory from pixel-coordinate and frame-index
formulae; it did not read an ignored fixture or write generated image assets.

Two transparent RGBA artworks were generated:

- **Low motion:** a character-like face and body with a textured but otherwise
  stable fill. Only a waving arm, hand, and small sparkle move.
- **High motion:** a bounded circular reaction face with animated full-field
  color waves, frame-varying texture, a moving face, and rotating particles.
  This intentionally stresses APNG compression by changing much of the visible
  foreground on every frame.

The high-motion case is a synthetic stress case, not evidence about the
distribution of real Emoji artwork.

Each generated sequence went through
[`processAnimated`](../src/pipeline/processAnimated.ts), not a standalone PNG
size estimator. All runs used:

- `bounds: maxBounds('animated-emoji')` (`180×180` exact output);
- `removeBackground: false`;
- shared-sequence transparent trimming and a 4 px output margin;
- `preserveFrames: true`;
- `forbidPalette: true`;
- one loop and an exact one-second per-loop duration;
- the Animated Emoji 5–20 frame and 1/2/3/4-second limits contract;
- the project limit of `300,000` bytes.

The original-color run used UPNG `colors=0` with no auto-fit. Each explicit
256/128/64 run used a single-rung, full-frame ladder for that exact color
ceiling. This isolates the measured ceiling instead of allowing the automatic
ladder to silently choose a lower color count. Color-reduced outputs remained
RGBA truecolor containers (`PNG color type 6`) because palette output was
forbidden; that storage type does not mean that original color fidelity was
preserved.

The final APNG bytes were reopened by the processor and passed to
[`validateAnimatedEmojiImage`](../src/core/validate.ts). The table reports facts
from those final decoded bytes, not requested settings.

## Environment and command

| Component | Observed value |
| --- | --- |
| Repository base commit | `c686fc5` (measurement ran on the current dirty working tree) |
| Architecture | `x86_64` |
| Node.js | `v24.5.0` |
| Sharp | `0.33.5` |
| UPNG.js | `2.1.0` |
| Matrix cases | 24 |
| Repeated matrix SHA-256 | `abc819a18989bd64fd7f08edd82edb7ebf82cd2594998e9a720ec7db70c99e5e` |

Command run from the repository root:

```bash
./node_modules/.bin/tsx /tmp/emoji-apng-feasibility.mts
```

The complete matrix was then run twice more with `--digest`; both repetitions
produced the same matrix SHA-256 shown above.

## Exact results

`Frames/distinct` shows decoded APNG frame count followed by decoded distinct
visual frames. Every row preserved its requested frame count, had no adjacent
duplicate frames, decoded to `1,000 ms × 1 loop`, was exactly `180×180`, and had
PNG color type 6.

| Artwork | Source frames | Color ceiling | Exact bytes | `≤300,000` | Frames / distinct | Duration × loops | ctype |
| --- | ---: | --- | ---: | :---: | ---: | --- | ---: |
| Low motion | 5 | Original (`0`) | 95,963 | Yes | 5 / 5 | 1,000 ms × 1 | 6 |
| Low motion | 5 | 256 | 47,341 | Yes | 5 / 5 | 1,000 ms × 1 | 6 |
| Low motion | 5 | 128 | 38,682 | Yes | 5 / 5 | 1,000 ms × 1 | 6 |
| Low motion | 5 | 64 | 29,044 | Yes | 5 / 5 | 1,000 ms × 1 | 6 |
| Low motion | 10 | Original (`0`) | 176,232 | Yes | 10 / 10 | 1,000 ms × 1 | 6 |
| Low motion | 10 | 256 | 86,761 | Yes | 10 / 10 | 1,000 ms × 1 | 6 |
| Low motion | 10 | 128 | 70,178 | Yes | 10 / 10 | 1,000 ms × 1 | 6 |
| Low motion | 10 | 64 | 54,286 | Yes | 10 / 10 | 1,000 ms × 1 | 6 |
| Low motion | 20 | Original (`0`) | 335,560 | **No** | 20 / 20 | 1,000 ms × 1 | 6 |
| Low motion | 20 | 256 | 164,930 | Yes | 20 / 20 | 1,000 ms × 1 | 6 |
| Low motion | 20 | 128 | 133,686 | Yes | 20 / 20 | 1,000 ms × 1 | 6 |
| Low motion | 20 | 64 | 104,072 | Yes | 20 / 20 | 1,000 ms × 1 | 6 |
| High motion | 5 | Original (`0`) | 301,199 | **No** | 5 / 5 | 1,000 ms × 1 | 6 |
| High motion | 5 | 256 | 113,899 | Yes | 5 / 5 | 1,000 ms × 1 | 6 |
| High motion | 5 | 128 | 88,355 | Yes | 5 / 5 | 1,000 ms × 1 | 6 |
| High motion | 5 | 64 | 67,906 | Yes | 5 / 5 | 1,000 ms × 1 | 6 |
| High motion | 10 | Original (`0`) | 596,963 | **No** | 10 / 10 | 1,000 ms × 1 | 6 |
| High motion | 10 | 256 | 227,352 | Yes | 10 / 10 | 1,000 ms × 1 | 6 |
| High motion | 10 | 128 | 175,411 | Yes | 10 / 10 | 1,000 ms × 1 | 6 |
| High motion | 10 | 64 | 134,216 | Yes | 10 / 10 | 1,000 ms × 1 | 6 |
| High motion | 20 | Original (`0`) | 1,188,788 | **No** | 20 / 20 | 1,000 ms × 1 | 6 |
| High motion | 20 | 256 | 453,641 | **No** | 20 / 20 | 1,000 ms × 1 | 6 |
| High motion | 20 | 128 | 348,080 | **No** | 20 / 20 | 1,000 ms × 1 | 6 |
| High motion | 20 | 64 | 270,745 | Yes | 20 / 20 | 1,000 ms × 1 | 6 |

All failing validations had only the blocking `animatedEmoji.bytes` error.
Passing rows had no blocking validation errors. All rows also retained the
validator's explicit warning that PNG density metadata was unavailable; this
experiment did not prove the 72 dpi metadata requirement.

## Observed, inferred, and unverified

### Observed

- The exact 24-row byte matrix above was produced by the current Node
  processor/encoder and was byte-for-byte deterministic across two complete
  repetitions under the recorded environment.
- All delivered files decoded as 180×180 RGBA APNGs with color type 6, one
  loop, exactly 1,000 ms per loop, and the requested 5/10/20 frames.
- Every decoded frame was distinct under exact RGBA pixel comparison, even with
  the 64-color ceiling. This does not measure perceptual difference.
- Original-color encoding failed four of six cases. Explicit 256 and 128
  ceilings each failed the synthetic high-motion 20-frame case. Explicit 64
  passed every measured case.

### Inferred

- The existing encoder is sufficient for these two synthetic cases when an
  explicit reduction ladder is available; this measurement does not support
  adding another dependency solely to satisfy Milestone 0.
- Original-color output cannot be treated as a reliable default success path
  at 300,000 bytes. A blocking result plus an explicit user-selected reduction
  retry is necessary.
- High full-frame change is a stronger size driver than frame count alone: the
  high-motion five-frame original was larger than the low-motion ten-frame
  original.

### Not verified

- No production, commissioned, AI-generated, or hand-drawn Emoji corpus was
  measured. Synthetic pass rates must not be presented as real-artwork pass
  rates.
- The browser encoder was not run in this experiment. It shares the UPNG
  approach, but browser/Node byte parity is outside this evidence.
- No visual quality review was performed. Distinct decoded frames and color
  type 6 do not prove that 64-color reduction preserves gradients, text, skin
  tones, or brand colors acceptably.
- The generated APNGs were not uploaded to LINE My Page. Local validator success
  is diagnostic evidence, not proof of LINE acceptance.
- ZIP assembly, the 20 MB pack boundary, PNG density emission, and semantic
  requirements such as first-frame meaning and chat-size legibility were
  outside this item-compression measurement.

## Decision for Milestone 0

Keep the current Node UPNG path and its existing browser counterpart for the
first Animated Regular Emoji slice, while retaining separate browser parity
checks. Preserve frames and truecolor RGBA storage, try original colors first,
and report an over-budget original as a blocking result. Offer 256/128/64
reduction only as an explicit user choice and revalidate the final decoded
bytes after each choice. Do not claim that the 64-color fallback is acceptable
until representative real artwork receives visual review, and keep My Page
acceptance as a separate release gate.
