# fix(#676 B1): adopt the FIRST inline image (data + MIME atomically) in image-gen

Part of #676. Priority-B item B1.

## Problem

`server/backends/image-gen.ts` reduced the Gemini response `parts` inline. Its comment
claimed it took "the first inline image", but the `for` loop had no `break`, so each
image part overwrote the previous one and the **last** image actually won. Worse, `imageData`
and `mimeType` were tracked independently: an allowed-MIME image followed by a
disallowed-MIME image left `imageData` pointing at the last part while `mimeType` kept an
earlier value (or vice versa), so the emitted `data:` URL could pair one part's bytes with
another part's MIME — a desync. The whole thing was reachable only through a live Gemini
call, so it was untested.

## Change

Extract the decision into a new pure module `server/backends/imageResult.ts` and have
`image-gen.ts` call it right after the `ai.models.generateContent` I/O.

Public API:

- `extractImageResult(parts: Part[]): { imageData?: string; mimeType: string; text?: string }`
  — adopts the FIRST inline image and reads its `data` and `mimeType` from that **same**
  part (via `Array.find`), so the two can never desync. `text` is the FIRST text part, for
  the same first-wins consistency.
- `ALLOWED_IMAGE_MIME` — the safe image MIME allowlist (png/jpeg/webp/gif), moved here from
  `image-gen.ts` (it had no other consumer).

The MIME comes from the untrusted model response and is embedded into a `data:` URL, so when
the first image's MIME is outside the allowlist we fall back to `"image/png"` — but the bytes
stay that same part's, preserving atomicity. Behavior decision (first-wins) was confirmed
with the user; it matches the file's own comment and the MulmoClaude `gemini.ts#extractImageResult`
mirror the file claims to follow.

## Tests

`test/server/backends/imageResult.spec.ts`:

- single image + text → correct `{ imageData, mimeType, text }` data-URL material.
- multiple images → the FIRST is adopted (pinned distinct from the second's bytes and MIME).
- first image's MIME outside the allowlist → `mimeType` is `"image/png"` while `imageData`
  is **that same disallowed part's** bytes (the desync regression guard).
- no image → `imageData` undefined, text returned.
- an `inlineData` part with no `data` is not treated as an image.
- empty-string text part is skipped in favor of a later real one (truthiness parity).
- no text / empty parts.

## Mutation check

Changing `parts.find(...)` to `parts.findLast(...)` for the image part (i.e. last-wins,
the pre-fix behavior) turned the "adopts the FIRST image" test red; reverted after confirming.

## Verification

`prettier --write` + `eslint` on the touched/new files; `typecheck`, `typecheck:server`,
`typecheck:test`; `vitest run test/server/backends`.
