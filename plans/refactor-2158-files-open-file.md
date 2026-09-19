# refactor: lift the Files pane's OPEN FILE into a composable (#2158)

## Why

The second and largest of the extractions #2158 asks for, and the last one with real weight in it.
The tree went out in #2169; what remained in `FilesPane.vue` was mostly the open file — the buffer,
the editor it is shown in, how it is read, where the reader was in it, and every way it is written
back. The pane is a file explorer and an editor sharing one component, and those two halves speak to
each other in exactly two places.

## What moved, and what did not

Moved to `src/composables/useOpenFile.ts`: `openPath` and its name, `dirty` / `editSeq`, `saving`,
`fileError`, `unpreviewable`, `baseVersion`, `conflict`, `showPreview` / `isMarkdown`, the editor
handle and the read generation — with the functions that decide from them: the read and the two
adoptions it ends in, the place a reader is restored to, the save and both answers to a conflict,
the flush on the way out, the `pagehide` write, and the disk watch that notices the agent in this
directory editing the same file.

Stayed in the pane: **the markup**, as in #2151 and #2169 — what renders does not move, so the DOM
is identical by construction. Also the tree, the finder, the reveal, the row menu and the row
actions, all of which are the pane's own ends: they read its props or they emit.

`FilesPaneState` moved too, into `src/components/filesPaneState.ts`. Three parties decide from it
and none of them owns it — the pane fills it, `TerminalGrid` files it per cell, and
`filesPaneStore` puts it in localStorage per directory — so it had outlived the component it was
declared in, and a composable importing it from the `.vue` would have been a cycle.

## The lifecycle went with the file, not with the pane

The `pagehide` listener and the external-change watch are registered by the composable and undone
when its host unmounts. They belong to the open file rather than to the pane: both exist to make
sure a buffer is not lost and that a file changed underneath is noticed, and leaving them behind
would have split one rule across two files.

## The shape the size limit produced

`max-lines-per-function` is 60, and everything here inside one `useOpenFile` closure would be
several times that. So the functions are module-level and take an explicit context. That is not a
workaround: the same shape is what makes each of them reachable from a test with a state it made
itself, which is what `test/src/composables/useOpenFile.spec.ts` now does.

## How it was proved

A throwaway differential harness mounted the pane before and after and compared whole outputs:
five scenarios (a plain file, one read in Preview, one the server will not serve as text, a save
that conflicts, a read that fails), each with and without a restored state, recording the header
and body HTML, the emits, the snapshot, the request sequence and the editor calls after every step.
Every record came back identical. The harness is deleted — half of it was the code it was proving.

What survives it is `useOpenFile.spec.ts`: the generator (the answers the two endpoints can give)
and the property (what the buffer says about itself afterwards, and what was sent).

A mutation sweep then asked whether the tests are worth anything. Each decision in the new file was
inverted in turn and both suites re-run: every mutation was caught, the pre-existing pane specs
missed two of them, and the new spec is what catches those two — `save()` refusing to write over a
file the server would not serve as text, and `pagehide` sending the buffer both ways with
`keepalive`. Neither is cheap to arrange through a mounted pane, which is why neither was covered.

## Carried debt, paid here

#2169's ledger promised a case for a child listing that comes back EMPTY but successful — the row
stays open over nothing and is not asked for again, which is not what a listing that failed does.
It is in `useFilesTree.spec.ts` now.
