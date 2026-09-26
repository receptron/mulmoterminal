# fix: undo right after opening a file empties the buffer (#2258)

## Problem
`cmEditor.setDoc` loaded a file by dispatching a whole-document replace into the existing
`EditorState`. `basicSetup`'s history recorded it, so Cmd+Z right after opening undid the load:
the buffer went empty (or back to the previously opened file), `onChange` fired, the pane marked
it dirty, and the save-on-leave wrote that to disk.

## Fix
`setDoc` builds a fresh `EditorState` (same extensions, the language compartment seeded with the
file's mode) and hands it to `view.setState`. A new state has an empty history, and `setState`
is not a transaction, so the update listener never sees the load — the `loading` flag goes away.
The lazily loaded grammars still arrive through `lang.reconfigure` on the same compartment.

This is also the shape tabs (#2267) need: one state per file.

## Spec
`test/src/components/cmEditorUndo.spec.ts`, driven through the real keymap (Ctrl+Z in jsdom):
- undo right after opening changes nothing and does not call `onChange`
- after opening a then b, undo does not bring back a
- an edit made to a is not undoable once b is open
- an edit to the open file is still undoable
