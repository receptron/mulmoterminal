# fix: the plugin file operations' stat and readDir re-check after reading (#3306)

## Problem

`createFileOps` (`server/backends/files/fileOps.ts`) is the file access handed to plugins: the shared
artifacts folder, each plugin's data and config folders, and the MulmoScript stories folder. Its
`stat` (size and modified time) and `readDir` (names in a folder) checked the path, then read it by
name. A folder swapped for a link out in between handed the plugin an outside file's size and time, or
an outside folder's names. With the spec below, the code before this change did exactly that.

## Change

Both ask the existing containment check again once they have read, and throw the existing escape
error if it no longer names a place inside, so nothing read reaches the plugin. This is the same shape
as `/browse/list` and `/browse/head` (#3317).

## Not changed / what this does not hold

- A swap undone before the check is asked again is not seen.
- `exists` and `unlink` stay check-then-act. `exists` answers only true or false; `unlink` never
  follows the last component, and its parent is the entry the check resolved.

## Verification

- `test/server/backends/files/fileOps-swap.spec.ts`:
  - `readDir` with the swap at its `readdir`, and `stat` with the swap at its `stat`, throw the escape
    error;
  - with nothing moved, both answer;
  - against the code before this change, both resolved with the outside data.
- Removing either re-check makes its case fail.
- No route in this repo calls them: the shipped MulmoScript plugin only forwards them. A plugin
  installed by the user is what calls them, against its own data and config folders. So they are
  verified through `createFileOps` on the real filesystem, not through a running server.
