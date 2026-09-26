# feat: switching to Preview saves unsaved edits first (#2262)

## Problem
The Edit/Preview button only flipped `showPreview`. Preview is an iframe onto the file ON DISK
(`previewSrc` uses the disk version), so after typing, Preview showed the old text.

## Fix
`useOpenFile` gains `togglePreview`, and the button calls it:
- Preview → Edit: switch, write nothing.
- Edit → Preview: if the buffer is dirty, `save` first. Switch only if it landed, i.e. the buffer
  is clean afterwards. A conflict (409) keeps the editor with its banner; an error keeps the
  editor with its message. This extends the pane's existing rule that it saves without asking
  whenever it is left.
- The button is disabled while a save is in flight, so a click cannot silently do nothing.
- Identity is the pane's read generation (`reqId`), which every read bumps. If another file was
  read in while the save was out, the Preview is not applied to it. `save()` itself also drops
  its late outcome: a version, conflict or error learned about one file must not become another
  file's baseline or banner. This race already existed for Save / ⌘S; cross review round 1 found
  it on this path, and the fix covers both.

The iframe then loads the saved version, because `previewSrc` carries the new `baseVersion`.

## Spec
`test/src/components/filesPanePreviewSave.spec.ts` covers:
- dirty → one write, then Preview at the saved version
- clean → no write
- 409 → stays in Edit with the conflict banner
- error → stays in Edit with the message
- a file opened mid-save is not switched, does not take the late save's version, and gets no
  banner from its 409
- the button is disabled while a save is in flight
- back to Edit writes nothing

Each decision was removed in turn, and the spec went red for each.
