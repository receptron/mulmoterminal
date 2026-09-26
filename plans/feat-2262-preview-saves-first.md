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
- If another file was opened while the save was out, the Preview is not applied to it.

The iframe then loads the saved version, because `previewSrc` carries the new `baseVersion`.

## Spec
`test/src/components/filesPanePreviewSave.spec.ts` covers:
- dirty → one write, then Preview at the saved version
- clean → no write
- 409 → stays in Edit with the conflict banner
- error → stays in Edit with the message
- a file opened mid-save is not switched
- back to Edit writes nothing

Each of the three decisions was removed in turn, and the spec went red for each.
