# LINE Emoji and Animated Emoji Support Plan

Status: Regular Emoji V1 implemented and locally verified; external release acceptance incomplete
Date: 2026-08-04
Scope: Node CLI, browser app, shared core, static emoji, and animated emoji

## Implementation progress

| Milestone | Status | Evidence / remaining work |
| --- | --- | --- |
| 0 — Contract and feasibility | Partial | Official rules, unknown-density policy, and a deterministic 24-case 5/10/20-frame low/high-motion compression matrix are recorded. Authenticated My Page ZIP acceptance and visual review on representative finished artwork remain open. |
| 1 — Shared contracts and tests | Implemented and verified | Dedicated specs, names, manifests, validators, boundary cases, and regression tests are present; the observed root suite passed 98/98. |
| 2 — Image/APNG processing | Implemented and contract-tested | Exact 180×180 static/sequence fitting, frame preservation, legal timing, final-byte inspection, and Node/browser processing contracts are present. Synthetic compression evidence supports retaining UPNG, without claiming real-art visual quality. |
| 3 — Packaging, config, and CLI | Implemented and exercised | Legacy defaulting, Emoji config/init, all existing commands, main-less three-digit ZIPs, and invalid-result exits were exercised end to end. Some errors state the observed value and limit but do not yet include a suggested retry. |
| 4 — Browser integration | Implemented and smoke-verified | Build, Sheet, both ordinary Animation modes, Prompt, discriminated results, previews, explicit reduction, and hard download gates are wired. A dedicated Playwright smoke completed both Emoji UI journeys and inspected their downloaded bytes and ZIP manifests. |
| 5 — Documentation and acceptance | Documentation complete; external acceptance open | Long-lived docs describe both products and limitations. ZIP manifests were inspected locally; no authenticated My Page test upload was performed. |
| 6 — Fixed sequence sets | Deferred | Not implemented. |
| 7 — Video integration | Deferred | Video-to-Animated-Emoji is not implemented. |

Observed verification for this V1 implementation: root `npm run typecheck`, `npm test` (98/98), and
`npm run build` passed; browser `npm run typecheck`, `npm run build`, output-safety and Emoji processing
contracts, and the dedicated Emoji browser smoke passed. Static and animated CLI ZIPs were opened and
contained exactly `tab.png` plus `001.png` onward. An Animated Regular Emoji was decoded as 180×180
truecolor APNG with five distinct frames, one loop, 1,000 ms duration, and 19,920 final bytes. A
1.5-second input failed with a non-zero exit as required. These observations are local technical
evidence, not Creators Market acceptance.

## Recommendation

Add emoji to the existing Build, Sheet, Animation, and Prompt workflows, and reuse the existing cutting, background-removal, fitting, PNG/APNG encoding, and inspection code. Do **not** model emoji as merely another sticker size. Emoji needs its own product profile, validator, file naming, and ZIP assembler because its upload contract differs from every existing sticker product.

The first shippable slice should support **Regular Emoji** and **Animated Regular Emoji**, with any count from 8 through 40. The fixed Kana/letter/number/symbol set types should be a second slice built on an ordered-slot manifest. This keeps the first delivery useful without pretending that a count-only sticker workflow can safely author fixed semantic sequences.

## Success outcome

A user can use the same application and commands they already know to:

1. build a static regular-emoji pack from individual images or a sheet;
2. build an animated regular-emoji pack from animation sheets or frame sequences;
3. generate an emoji-aware prompt;
4. preview and validate the final encoded files;
5. download a LINE-shaped ZIP containing `tab.png` and `001.png` through `040.png`, with no uploaded `main.png`;
6. receive a hard failure when any final file or package violates the selected emoji contract.

Existing sticker behavior and legacy configuration must remain unchanged.

## Evidence ledger

### Observed: official LINE contract

The current official pages specify the following contracts:

| Contract | Static regular emoji | Animated regular emoji |
| --- | --- | --- |
| Item count | 8–40 | 8–40 |
| Item canvas | exactly 180×180 px | exactly 180×180 px |
| Item format | PNG | APNG with `.png` extension |
| Item limit | 1 MB | 300 KB |
| Chat thumbnail | one 96×74 px PNG | one 96×74 px PNG |
| Main display image | select four registered emoji in My Page; do not upload a separate `main.png` | same |
| Item names | three digits, beginning at `001.png` | same |
| ZIP limit | less than 20 MB | 20 MB or less |
| Animation | n/a | 5–20 frames; 1–4 loops; one loop lasts 1, 2, 3, or 4 seconds; total playback is at most 4 seconds |
| Semantic rule | legible as a small inline image | first frame must convey the meaning; all frames cannot be identical |

Sources:

- [LINE Emoji Guidelines](https://creator.line.me/en/guideline/emoji/)
- [LINE Animated Emoji Guidelines](https://creator.line.me/en/guideline/animationemoji/)
- [Animated Emoji Production Details](https://creator.line.me/en/guideline/animationemoji/detail/)
- [Emoji set types and file naming](https://creator.line.me/en/guideline/emoji/detail/)
- [LINE Creators Market Help](https://help2.line.me/creators/web/categoryId/20005266/3/pc?lang=en)

The fixed sequence variants are a different authoring contract from Regular Emoji:

| Set type | Total slots | Regular-emoji suffix |
| --- | ---: | --- |
| Regular Emoji | 8–40 | all submitted slots |
| Kana + letters/numbers/symbols + Regular Emoji | 273–305 | `266`–`305`, as selected |
| Kana + Regular Emoji | 169–201 | `162`–`201`, as selected |
| Letters/numbers/symbols + Regular Emoji | 112–144 | `105`–`144`, as selected |
| Kana + letters/numbers/symbols | 265 | none |
| Kana | 161 | none |
| Letters/numbers/symbols | 104 | none |

The exact required semantic content and ordering for fixed sequences must be represented by data, not inferred from filenames or a free-form prompt.

### Observed: pre-implementation repository baseline

The following bullets describe the repository when this plan was written, not its current V1 state:

- The CLI and browser were already adapters around platform-neutral rules in [`src/core/`](../src/core/), as described in [`ARCHITECTURE.md`](../ARCHITECTURE.md).
- Specification, validation, naming, packaging, and result models assumed a two-digit sticker archive with `main.png` and `tab.png`.
- Static fitting did not combine content trimming with an exact 180×180 output, and the Node animated processor imported sticker limits directly.
- Animation paths could clamp timing or reduce frames without the stricter Emoji final-byte contract.
- The local guideline summary already recorded official Emoji rules, but its runtime-support paragraph was stale.
- There were no Emoji runtime paths or committed Emoji contract tests.

### Inferred design constraints

- Pixel processing can be shared, while package and validation contracts must remain product-specific.
- A generic “optional main image” pack model would make invalid states easy to construct. A discriminated emoji package result is safer than weakening the sticker result type.
- Fixed sequence sets need an ordered manifest with slot identity, required content, filename, and completion state. They cannot safely reuse only `count` plus free-form variations.
- The 300 KB animated-emoji ceiling is likely to be the hardest operational constraint. Existing compression should be measured at 180×180 before adding another codec or dependency.
- Individual-frame stabilization and sheet-grid alignment remain separate. Per-frame trimming must not recenter away deliberate animated motion.

### Assumptions to validate during implementation

- The repository's current binary byte convention is accepted for LINE's displayed KB/MB limits. Tests must encode the chosen byte constants explicitly.
- A ZIP containing only `tab.png` plus the numbered emoji PNGs is the upload shape accepted by the current My Page flow.
- The existing APNG encoder can produce representative 180×180 animations at or below 300 KB with explicit, user-visible color reduction and without dropping below five meaningful frames.
- PNG density metadata can either be emitted consistently in both runtimes or reported honestly as unverifiable; a successful local report must not claim upload acceptance when density evidence is unknown.

## Pre-work review: challenge, delete, then optimize

### 1. Challenge the requirements

**Is emoji only a new image size?** No. It changes exact dimensions, valid counts, numbering width, support images, archive size, animation size, and validation semantics.

**Does “merge into the existing feature” require a new top-level Emoji tab?** No. The user's task is selected naturally inside Build, Sheet, Animation, and Prompt. A sixth tab would duplicate source acquisition and processing controls.

**Must the first release cover all seven set types?** No. Regular Emoji provides the complete core pipeline and supports useful 8–40 item packs. Fixed Kana and letter sets add hundreds of mandatory semantic slots and require a distinct ordered-authoring experience. Treating them as a larger Regular pack would be misleading.

**Must Video support animated emoji immediately?** No. Video has a persisted V2 project and timing pipeline of its own. Animated emoji can first be proven through the existing frame and animation-sheet inputs, then Video can consume the stable product profile in a follow-up.

**Must a new APNG optimizer be added?** Not until representative 180×180 fixtures show that the current truecolor/palette ladder cannot meet 300 KB at acceptable quality.

### 2. Delete or defer unnecessary scope

Delete from the first shippable slice:

- a separate Emoji top-level tab;
- direct publishing or authentication with LINE Creators Market;
- an uploaded `main.png` for emoji;
- fixed Kana/letter/number/symbol set authoring;
- Video-to-animated-emoji output;
- image-generation provider calls;
- a repository-wide rename of every existing `StickerKind` use;
- a new APNG compression dependency before the size spike produces evidence that it is needed.

These are explicit scope decisions, not permanent product exclusions. Fixed sequence sets and Video integration are follow-up milestones below.

### 3. Simplify and optimize the retained work

- Introduce one emoji product profile per motion type and route existing workflows through it.
- Keep dedicated sticker and emoji pack assemblers instead of one assembler with many optional arguments.
- Make content cropping and output-canvas sizing orthogonal so Node and browser processors can share the same behavior contract.
- Validate decoded final bytes, not only intended encoder settings.
- Preserve legacy configuration by defaulting an absent product field to `sticker`.
- Use target-aware result metadata so the UI renders only support assets that actually exist.

## Target architecture

### 1. Product identity and configuration

Keep the existing sticker-only type usable by current call sites. Add a broader pack target only where code genuinely handles multiple product families:

```ts
type EmojiKind = 'emoji' | 'animated-emoji';
type LinePackKind = StickerKind | EmojiKind;
type EmojiSetType = 'regular'; // expanded by the fixed-sequence milestone
```

Extend the CLI configuration without breaking existing YAML:

```yaml
package:
  name: reactions
  product: emoji       # optional; defaults to sticker for legacy configs
  animated: false
  emojiSet: regular    # required when product is emoji; only regular in V1
  count: 16
```

Resolve that to `emoji` or `animated-emoji` once in [`src/config/load.ts`](../src/config/load.ts). Reject unknown products, emoji-only fields on stickers, unsupported set types, and cross-field conflicts. Do not scatter `product === 'emoji'` inference through commands.

The CLI remains command-oriented rather than adding parallel emoji commands:

- `build` and `gen` accept static `product: emoji` configurations;
- `anim` accepts animated `product: emoji` configurations;
- `prompt` gains an emoji target;
- `init` can emit a regular emoji example through an explicit option while preserving the current default template.

### 2. Shared specification profiles

Add `EMOJI_SPEC` and `ANIMATED_EMOJI_SPEC` to [`src/core/spec.ts`](../src/core/spec.ts). Keep LINE constants in that file and include:

- exact 180×180 item bounds;
- regular count range 8–40, represented as a range rather than a discrete sticker list;
- 96×74 tab bounds;
- no independent main-image requirement;
- 1 MB static or 300 KB animated item limit;
- product-specific 20 MB ZIP limit and strict/inclusive comparator;
- three-digit numbering;
- animated frame, loop, per-loop duration, and total-playback limits.

Expose small queries such as `allowedCount(kind, count)`, `itemBounds(kind)`, and `packageLimit(kind)` instead of adding emoji branches to unrelated UI code. Preserve existing exports until all current sticker callers and tests remain green.

### 3. Naming and archive shape

Add explicit naming helpers in [`src/core/naming.ts`](../src/core/naming.ts):

```ts
emojiFileName(1)   // 001.png
emojiFileName(40)  // 040.png
```

Do not change `stickerFileName()`.

Create dedicated Node and browser emoji archive builders:

- [`src/package/buildEmojiZip.ts`](../src/package/buildEmojiZip.ts)
- [`web/src/webpipe/emojiZip.ts`](../web/src/webpipe/emojiZip.ts)

Their input contract requires exactly one tab image and the expected numbered emoji items. It has no `main` field. Builders must reject duplicate paths, gaps, wrong count, out-of-range names, and unexpected support images before producing a downloadable ZIP.

Use one shared core function to produce the expected path manifest so Node and browser cannot disagree about filenames.

### 4. Validation boundary

Add product-specific validators in [`src/core/validate.ts`](../src/core/validate.ts):

- `validateEmojiImage()`;
- `validateAnimatedEmojiImage()`;
- `validateEmojiPack()`.

Do not make `main` optional in the existing sticker pack validator. Popup already demonstrates that a distinct package shape deserves a distinct validator.

Static emoji validation must check the final encoded file for:

- PNG format;
- exactly 180×180 pixels;
- RGB/RGBA color model and alpha/transparency evidence;
- at most 1 MB per item;
- expected three-digit path;
- non-empty visible content;
- count between 8 and 40 inclusive;
- a valid 96×74 tab image;
- a ZIP strictly under 20 MB.

Animated emoji validation must additionally check:

- APNG structure with `.png` filename;
- at most 300 KB per item;
- 5–20 decoded frames;
- 1–4 encoded loops;
- decoded one-loop duration exactly 1,000, 2,000, 3,000, or 4,000 ms within a documented integer-delay tolerance;
- decoded duration multiplied by loops at most 4,000 ms;
- at least two distinct decoded frames;
- first-frame presence and decode success;
- an animated ZIP at most 20 MB.

The first-frame meaning, letter legibility, low-margin guidance, and readability at chat size need a user preview/warning. They are semantic review items and must not be reported as machine-proven facts.

Extend `ImageInfo` only with evidence that can be read from final bytes: format, decoded duration, distinct-frame count, density when present, transparency, foreground bounds, and filename. If evidence is unavailable, report `unknown`; never convert missing evidence into a passing assertion.

### 5. Reusable pixel processing

Refactor both [`src/pipeline/fitCanvas.ts`](../src/pipeline/fitCanvas.ts) and [`web/src/webpipe/fitCanvas.ts`](../web/src/webpipe/fitCanvas.ts) so these two decisions are independent:

1. crop transparent source padding or preserve the source frame;
2. output a bounded variable canvas or an exact canvas.

Emoji selects crop-to-content plus exact 180×180 output. Existing static stickers retain crop-to-content plus bounded output. Existing animations retain their current motion-preserving behavior unless their explicit profile changes it.

For animated emoji:

- require a consistent source canvas/aspect ratio, or reject the sequence with a clear diagnostic;
- never silently stretch mismatched source frames to the first frame's dimensions;
- compute a sequence-wide union content box when transparent padding must be removed;
- apply one scale and placement transform to every frame;
- keep optional subject stabilization separate and default it conservatively so intended movement is not erased;
- decode the produced APNG again and validate its actual frames, loops, timing, size, and distinctness.

Parameterize the Node animated processor with the same explicit limits contract already present in the browser processor. Avoid creating a third animation implementation.

### 6. Compression policy

Before choosing an encoder change, run a tracked, reproducible 180×180 spike with representative artwork:

- 5, 10, and 20 frames;
- low-motion and high-motion examples;
- truecolor and the existing 256→16 color ladder;
- one through four loops where applicable;
- final decoded quality, frame count, timing, and byte size recorded.

Default behavior must preserve the requested frames and return a blocking over-budget result. Color reduction is an explicit retry or explicit config choice. Frame reduction, if retained at all, must be separately opt-in, must never fall below five frames, and must still pass distinct-frame validation.

Only evaluate another APNG optimizer if the spike shows that the existing path cannot meet 300 KB for normal inputs. Any added codec must work in both Node and browser or be isolated behind equivalent adapters with parity fixtures.

### 7. Browser integration

Integrate target selection into current workflows:

| Existing area | V1 change |
| --- | --- |
| [`BuildTab.tsx`](../web/src/ui/BuildTab.tsx) | Add Static Sticker / Regular Emoji target; derive counts, dimensions, processing, support assets, validator, and pack builder from the selected profile. |
| [`SheetTab.tsx`](../web/src/ui/SheetTab.tsx) | Add Regular Emoji beside Static and Big; allow every integer count from 8–40 and show the selected grid before cutting. |
| [`AnimTab.tsx`](../web/src/ui/AnimTab.tsx) | In sheet and pack modes, add Animated Sticker / Animated Regular Emoji target. Keep Popup a dedicated mode. |
| [`PromptTab.tsx`](../web/src/ui/PromptTab.tsx) | Add emoji-aware sheet/frame prompts emphasizing small-size readability, low margins, dark outlines, and first-frame meaning. |
| [`packResult.tsx`](../web/src/ui/packResult.tsx) | Replace the fixed sticker result shape with a discriminated sticker/emoji result so emoji omits main and displays three-digit filenames. |
| [`App.tsx`](../web/src/App.tsx) | Update product copy and official guideline links without adding a new navigation tab. |

The UI must show an emoji at both full 180×180 and a representative inline-chat size. Animated results must display final decoded duration, loops, frames, distinct frames, and bytes. ZIP download remains disabled when a blocking validation error exists.

### 8. Prompt and sheet semantics

Update [`src/core/prompt.ts`](../src/core/prompt.ts) and shared grid planning so “emoji” is a product target rather than merely substituted wording. Regular Emoji prompts should request:

- a transparent-background grid with the exact requested cell count;
- a single readable reaction or symbol per cell;
- strong silhouette, thick dark outline, and minimal margins;
- no tiny decorative detail that disappears inline;
- stable character identity when the set uses a character;
- for animated frames, a meaningful first frame and motion that remains understandable at 180×180.

Do not apply grounded-character grid alignment automatically to motion such as jumping. Preserve the architecture's distinction between aligning a frame sheet and stabilizing unwanted subject drift.

## Delivery plan

### Milestone 0 — Lock the contract and feasibility

Progress: **partial**. Official values, the density-warning policy, and the deterministic compression
matrix are recorded. Task 2 remains open because My Page was not accessed; the matrix is synthetic and
does not replace visual review on representative finished artwork.

1. Recheck all official links above on the implementation date and record any changed values in [`doc/line-creators-market-guidelines.md`](../doc/line-creators-market-guidelines.md).
2. Confirm the current My Page ZIP shape with a disposable regular-emoji package or current downloadable template. Record observed archive paths; do not infer a `main.png`.
3. Run the 180×180 APNG compression spike and decide whether the current encoder is sufficient.
4. Decide and document how PNG density is emitted and verified in Node and browser.

Exit criteria:

- the archive manifest, byte comparators, timing interpretation, and density evidence policy are explicit;
- representative animated output has a measured path to 300 KB, or the milestone records a concrete codec decision;
- no implementation depends on an unverified upload assumption.

### Milestone 1 — Shared contracts and tests

Progress: **implemented and verified**. All listed shared-contract tasks and exit cases are covered by
the current source and passing root tests.

Files:

- [`src/core/spec.ts`](../src/core/spec.ts)
- [`src/core/types.ts`](../src/core/types.ts)
- [`src/core/naming.ts`](../src/core/naming.ts)
- [`src/core/validate.ts`](../src/core/validate.ts)
- `.gitignore`
- new `test/emoji.test.ts`

Tasks:

1. Add static and animated emoji specifications and the broader target type.
2. Add count-range and exact-dimension helpers without changing sticker results.
3. Add three-digit naming and expected-manifest helpers.
4. Add dedicated item and pack validators driven by final-byte evidence.
5. Allowlist the new committed test file because the repository currently ignores most of `test/`.
6. Cover boundary and negative cases before wiring processors.

Exit criteria:

- counts 7 and 41 fail; 8, 9, and 40 pass;
- `001.png` and `040.png` are generated and two-digit names fail emoji validation;
- emoji packs do not require `main.png`, while existing sticker packs still do;
- static and animated ZIP boundary comparators are separately tested;
- all pre-existing core tests remain green.

### Milestone 2 — Exact image and APNG processing

Progress: **implemented and contract-tested** for V1. Exact fitting, shared sequence transforms,
5–20-frame preservation, legal timing, and final-byte evidence are present. The 24-case synthetic
[compression matrix](../doc/emoji-apng-feasibility.md) records when original/256/128/64-color paths fit
under 300 KB and why real-art visual review remains separate.

Files:

- [`src/pipeline/fitCanvas.ts`](../src/pipeline/fitCanvas.ts)
- [`web/src/webpipe/fitCanvas.ts`](../web/src/webpipe/fitCanvas.ts)
- [`src/pipeline/processStatic.ts`](../src/pipeline/processStatic.ts)
- [`web/src/webpipe/processStatic.ts`](../web/src/webpipe/processStatic.ts)
- [`src/pipeline/processAnimated.ts`](../src/pipeline/processAnimated.ts)
- [`web/src/webpipe/processAnimated.ts`](../web/src/webpipe/processAnimated.ts)
- Node and browser APNG inspection modules
- focused fit/sequence/APNG tests and fixtures

Tasks:

1. Separate input cropping from output-canvas policy in both adapters.
2. Add exact 180×180 static output with low configurable margins.
3. Add sequence-wide animated fitting and explicit source-size rejection.
4. Parameterize Node animation limits rather than importing sticker limits inside the processor.
5. Make timing normalization choose only valid emoji durations; reject instead of silently producing an off-contract duration.
6. Inspect the final encoded APNG and populate complete validation evidence.
7. Keep compression changes explicit and parity-tested.

Exit criteria:

- Node and browser produce equivalent dimensions and validation facts for shared fixtures;
- no final emoji has a variable canvas;
- animation does not drift because of per-frame cropping;
- mismatched frame sizes are diagnosed instead of stretched;
- final APNG bytes satisfy frame, loop, timing, distinctness, and size rules.

### Milestone 3 — Packaging, config, and CLI

Progress: **implemented and exercised end to end**. Tasks 1–4 and 6 are complete. Task 5 is partial:
diagnostics identify the item/field, observed value, and limit, but not every path suggests a retry.

Files:

- [`src/package/buildMainTab.ts`](../src/package/buildMainTab.ts)
- new Node emoji ZIP module
- [`src/config/schema.ts`](../src/config/schema.ts)
- [`src/config/load.ts`](../src/config/load.ts)
- [`src/cli/index.ts`](../src/cli/index.ts)
- [`src/cli/commands/build.ts`](../src/cli/commands/build.ts)
- [`src/cli/commands/gen.ts`](../src/cli/commands/gen.ts)
- [`src/cli/commands/anim.ts`](../src/cli/commands/anim.ts)
- [`src/cli/commands/prompt.ts`](../src/cli/commands/prompt.ts)
- [`src/cli/commands/init.ts`](../src/cli/commands/init.ts)
- new configuration and CLI regression tests

Tasks:

1. Reuse tab generation but do not call main-image generation for emoji.
2. Assemble and validate the emoji manifest before writing the final ZIP.
3. Add backward-compatible `package.product` and `package.emojiSet` parsing.
4. Route existing commands through the selected product profile.
5. Emit actionable diagnostics containing item number, observed value, limit, and suggested retry.
6. Add static and animated regular-emoji example configs without changing the default legacy behavior.

Exit criteria:

- existing configs with no product field behave exactly as before;
- CLI builds static and animated regular-emoji packages with only `tab.png` plus three-digit items;
- invalid outputs do not get reported as successful packages;
- generated ZIP paths and final bytes pass the shared validator.

### Milestone 4 — Browser workflow integration

Progress: **implemented and browser-smoke verified**. All tasks are present. The dedicated smoke drove
the static and animated Emoji UI journeys, downloaded both packages, inspected their flat manifests,
and decoded final animated bytes.

Files:

- [`web/src/ui/BuildTab.tsx`](../web/src/ui/BuildTab.tsx)
- [`web/src/ui/SheetTab.tsx`](../web/src/ui/SheetTab.tsx)
- [`web/src/ui/AnimTab.tsx`](../web/src/ui/AnimTab.tsx)
- [`web/src/ui/PromptTab.tsx`](../web/src/ui/PromptTab.tsx)
- [`web/src/ui/packResult.tsx`](../web/src/ui/packResult.tsx)
- [`web/src/App.tsx`](../web/src/App.tsx)
- [`web/src/webpipe/mainTab.ts`](../web/src/webpipe/mainTab.ts)
- new browser emoji ZIP module
- [`web/scripts/emoji-smoke.mjs`](../web/scripts/emoji-smoke.mjs)

Tasks:

1. Add product targets to existing controls and reset incompatible state when the target changes.
2. Derive count selectors from a discrete list for stickers or an inclusive range for emoji.
3. Replace sticker-only result assumptions with discriminated results.
4. Add full-size and chat-size previews plus animated validation facts.
5. Add explicit compression/retry controls and preserve the original source state.
6. Add static and animated emoji smoke flows, including ZIP entry inspection.

Exit criteria:

- users can complete both workflows without visiting a separate tab;
- changing target cannot leave stale sticker bounds, main images, or two-digit names in the result;
- download is unavailable on hard validation failure;
- smoke coverage asserts `tab.png`, `001.png`, the absence of `main.png`, exact canvas sizes, and animated final-byte facts.

### Milestone 5 — Documentation and acceptance evidence

Progress: **documentation complete; external acceptance open**. The documented files now describe V1,
final-byte validation, compression behavior, and exclusions. Local ZIP inspection is complete; the
authenticated My Page upload gate was not run and is explicitly unverified.

Update:

- [`README.md`](../README.md)
- [`ARCHITECTURE.md`](../ARCHITECTURE.md)
- [`web/README.md`](../web/README.md)
- [`doc/line-creators-market-guidelines.md`](../doc/line-creators-market-guidelines.md)
- relevant example configuration

Document:

- supported regular emoji workflows;
- static versus animated limits;
- CLI configuration and browser target selection;
- the absence of an uploaded emoji main image;
- explicit compression behavior;
- fixed sequence and Video limitations;
- the distinction between local diagnostic validation and confirmed LINE acceptance.

As a release gate, manually inspect both ZIPs and attempt a non-commercial test upload in the current LINE My Page when credentials and authorization are available. If that external check cannot be run, ship only with a clearly recorded “My Page acceptance not verified” limitation.

### Milestone 6 — Fixed sequence emoji sets

Progress: **deferred; not implemented**.

After Regular Emoji is stable:

1. Add every official set type to `EmojiSetType`.
2. Store the required ordered sequence as a versioned core data manifest with stable slot IDs, filenames, display labels, and source citations.
3. Recheck ambiguous Kana/symbol details against the current official template before publishing the manifest.
4. Add completion UI that shows missing, duplicate, and misplaced semantic slots.
5. Generate prompts in bounded batches while preserving slot identity across sheet cuts.
6. Run the same flow for static and animated products; animated letter slots must show a clearly readable letter in the first frame.

Do not implement fixed sets as `count: 265` with anonymous items. Completion means every required slot is identified and validated.

### Milestone 7 — Optional Video integration

Progress: **deferred; not implemented**.

Only after the animated-emoji profile is stable, add Animated Emoji as a Video export target. Version the persisted Video V2 project schema if the target or encoding settings are stored. Reuse the same final-byte validator and emoji ZIP builder; do not fork a Video-specific emoji contract.

## Verification matrix

### Automated contract cases

| Case | Expected result |
| --- | --- |
| Static count 7 / 41 | fail |
| Static count 8 / 9 / 40 | pass |
| Animated count 8 / 9 / 40 | pass |
| 179×180 or 180×179 item | fail |
| Static item at and one byte over limit | boundary behavior matches spec |
| Animated item at and one byte over 300 KB | boundary behavior matches spec |
| Static ZIP at, below, and above 20 MB | strict `<` comparator proven |
| Animated ZIP at, below, and above 20 MB | inclusive `<=` comparator proven |
| `01.png` in emoji pack | fail |
| missing `001.png`, duplicate path, or gap | fail |
| emoji ZIP with `main.png` | fail as unexpected content |
| static PNG mislabeled APNG | fail animated validation |
| 4 or 21 decoded frames | fail |
| loops 0 or 5 | fail |
| one-loop duration 1.5 seconds | fail |
| one-loop duration × loops over 4 seconds | fail |
| all decoded frames identical | fail |
| repeated frames but at least two meaningful distinct frames and 5+ total | pass |
| unknown density evidence | explicit unknown/warning, never a claimed proof |

### Project checks

Run in proportion to the implementation milestone:

```bash
npm run typecheck
npm test
npm run build

cd web
npm run typecheck
npm run build
npm run test:output-safety
npx tsx --tsconfig tsconfig.json scripts/emoji-processing-contract.mts
```

For final browser verification, run the preview server separately and then the smoke suite:

```bash
cd web
npm run preview -- --port 4179
```

```bash
cd web
node scripts/smoke.mjs http://127.0.0.1:4179/
node scripts/emoji-smoke.mjs http://127.0.0.1:4179/
```

If ignored fixtures or the Playwright browser are unavailable, report that limitation rather than claiming the smoke test passed.

### Manual visual checks

- Review every static item at full size and simulated inline-chat size.
- Review each animation's first frame without playback.
- Watch the final decoded animation for jitter, clipped strokes/text, erased intended motion, and palette artifacts.
- Inspect ZIP paths directly and confirm no `main.png` exists.
- Select four representative emoji in the current My Page main-display flow when authorized.

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| 300 KB is unattainable for detailed 20-frame art | Run the spike first; expose color reduction; hard-fail over budget; add a codec only with evidence. |
| A generic pack abstraction weakens sticker validation | Keep dedicated discriminated pack inputs and validators. |
| Per-frame trimming erases motion or creates jitter | Use one sequence-wide transform and keep stabilization opt-in. |
| Browser and Node outputs diverge | Share specs/manifests/validation and run parity fixtures on final bytes. |
| Existing configurations break | Default absent `product` to sticker and add legacy fixtures. |
| Fixed letter sets are assembled in the wrong order | Defer them until an official ordered manifest and slot-aware UI exist. |
| Local validation is mistaken for LINE approval | Separate observed facts, warnings, and unknowns; retain a manual My Page release gate. |
| Product switching leaks stale UI state | Reset derived assets and validate the full target-specific result before enabling download. |

## Refutation pass

### Alternative: add `emoji` to `StickerKind`, change bounds, and reuse `buildPack()`

Rejected. That would still emit an invalid `main.png`, use two-digit names, enforce sticker count sets, apply the wrong ZIP cap, and miss animated emoji's 300 KB limit. The failure is in the product contract, not only the dimensions.

### Alternative: build a universal product-profile framework first

Rejected for V1. A repository-wide abstraction rewrite would touch stable Big and Popup paths without being necessary. The plan adds only the broader target at actual multi-product boundaries and keeps dedicated validators/assemblers for differing archive shapes.

### Alternative: claim animated emoji support once an APNG encodes

Rejected. A syntactically valid APNG can still exceed 300 KB, contain an invalid duration or loop combination, collapse to identical frames, or fail first-frame communication. Completion requires decoding and validating the final bytes.

### Strongest remaining uncertainty

The synthetic matrix shows that the existing encoder has a path under 300 KB for the measured cases,
but it does not prove that the required color reduction is visually acceptable on representative
finished artwork. Public documentation and local ZIP inspection also cannot prove that a generated ZIP
is accepted by the current authenticated My Page flow. Both remain explicit release checks rather than
being converted into implementation claims.

## Definition of done

Current V1 status:

- [x] Static and animated Regular Emoji are wired into CLI and browser supported inputs.
- [x] Existing workflows were extended without a new top-level Emoji tab.
- [x] Local archives use `tab.png` plus three-digit items and reject `main.png`.
- [x] Target-specific final-file decoding and validation are implemented and contract-tested.
- [x] Root regression tests/builds and browser typecheck/build/processing contracts pass.
- [x] Browser UI smoke journeys for both Emoji products were added, run, and their downloads inspected.
- [x] README, browser, architecture, guideline, and plan documentation describe V1 and its exclusions.
- [x] A deterministic 5/10/20-frame low/high-motion compression matrix is recorded; it is synthetic and
      does not claim real-art visual quality.
- [x] My Page acceptance is explicitly recorded as unverified.

The Regular Emoji slice is done only when:

- static and animated regular emoji work in both CLI and browser supported inputs;
- existing workflows are extended rather than duplicated behind a new top-level tab;
- final archives contain `tab.png` plus correct three-digit items and no `main.png`;
- all final files are decoded and pass the target-specific validator;
- static and animated boundary tests, Node/browser parity tests, regression tests, builds, and browser smoke flows pass;
- README and architecture documentation describe the new target and known limitations;
- 300 KB feasibility is evidenced with deterministic low/high-motion inputs and its limits are documented;
- My Page acceptance is either observed and recorded or explicitly left unverified.

Fixed sequence emoji and Video export are not part of the first slice; they become done only through Milestones 6 and 7 rather than through anonymous-count or Video-specific shortcuts.
