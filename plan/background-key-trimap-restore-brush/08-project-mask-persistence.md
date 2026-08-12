# 08 — Persist and validate Video correction masks

**What to build:** Make Video foreground corrections durable and safe in Project ZIP archives. Corrections round-trip as deduplicated, content-addressed lossless mask assets tied to exact raw visuals and source geometry, while old projects migrate safely and hostile or inconsistent mask data fails closed.

**Blocked by:** 07 — Add frame-scoped correction and shared calibration to Video.

**Status:** complete

- [x] The next project schema version records correction targets separately from background-mode settings.
- [x] Non-empty Keep masks are cropped to their non-zero bounds and stored losslessly with source dimensions, source content hash, bounds, byte length, and checksum.
- [x] Identical mask assets are stored once and may be referenced by multiple raw visual IDs.
- [x] Export followed by import restores exact correction bytes, target mappings, draft dirty/current state, and corrected output.
- [x] Switching removal mode can ignore a compatible correction set without destroying it.
- [x] Older projects import with an empty correction set and preserve reusable raw masters.
- [x] Current color-key renders with obsolete remover provenance are invalidated with a clear rerender/migration note.
- [x] Import rejects unknown visual IDs, conflicting duplicate targets, geometry mismatch, source-hash mismatch, malformed masks, undeclared assets, checksum mismatch, and decompression-limit violations.
- [x] Import enforces bounded edit count, decoded pixels, individual mask bytes, and aggregate mask bytes before unbounded allocation.
- [x] Corrupt correction data cannot invalidate or replace unrelated retained project assets silently.
- [x] Project round-trip, migration, rejection, cache identity, typecheck, and browser build checks pass.
