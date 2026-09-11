// The argv that shows a path in the OS file manager (#2039).
//
// Separate from the opener LIST, which is `openDirCommands()`'s: the same commands open a folder
// on each platform, and only what they are handed differs. Pure so every platform can be asserted
// on one machine — the branch that matters most is the one this machine cannot run.
import path from "node:path";

/** Windows has two spellings: `explorer` on win32, `explorer.exe` under WSL interop. */
const isExplorer = (cmd: string): boolean => cmd === "explorer" || cmd === "explorer.exe";

/**
 * How `cmd` should be asked to show `target`.
 *
 * A FILE is revealed with its folder open and the file selected, which is what makes it draggable
 * into a mail composer or an upload form. A DIRECTORY is opened, not selected in its parent —
 * the row the user right-clicked is the folder they want in front of them.
 *
 * An argv ARRAY, never a command line: a filename carrying a quote, a space or a `;` is one
 * argument here and cannot be reinterpreted as syntax. `/select,` is prefixed to the path rather
 * than passed separately because that is the form Explorer parses — it is one token to it.
 *
 * `xdg-open` gets the containing directory instead: no Linux file manager has a portable "select
 * this item", and landing next to the file is enough to drag it (the same call MulmoClaude makes,
 * server/api/routes/files.ts `revealArgv`).
 */
export function revealArgv(cmd: string, target: string, isDir: boolean): string[] {
  if (isDir) return [target];
  if (cmd === "open") return ["-R", target];
  if (isExplorer(cmd)) return [`/select,${target}`];
  return [path.dirname(target)];
}
