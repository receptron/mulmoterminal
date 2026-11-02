# fix: Volta's image dirs stay at the front of a cell's PATH (#3233, second half)

`volta run` prepends the image dir of the tool it picked (`<volta>/tools/image/node/<ver>/bin`). The
cell's PATH comes from the tmux client's environment through `sanitizePathEntries`, which keeps it, so a
bare `node` / `npm` runs that copy directly: a project's `volta` pin is ignored, Volta's default npm is
not used, and a global `npm i -g` into that dir outranks a later install (a cell's `claude`).

Follows [`fix-3233-volta-recursion-leak.md`](fix-3233-volta-recursion-leak.md); stacked on it because both
touch `pty-env.ts` and the `volta` workflow.

## Rule

Drop `<volta>/tools/image/<node|npm|yarn|pnpm>/<ver>[/bin]` only when the SAME PATH also holds that
Volta's shim dir `<volta>/bin`. The shim dir still finds a `node`, and with no shim dir on the PATH the
image dir may be the only one that does. Windows has no `bin` under an image dir and folds case.

## Order of work

1. Red: unit specs for the rule and two cases in `voltaCell.spec.ts` (the PATH starts with an image dir;
   `command -v node npm` in the cell must not name one).
2. Fix in `sanitizePathEntries`.

## Declined in review

- A user directory shaped exactly like Volta's (`<root>/tools/image/<tool>/<ver>[/bin]` beside its own `<root>/bin`) is dropped too. The rule is lexical because the sanitizer sees PATH text only; verifying a root needs `VOLTA_HOME`, unset on a default install and different on Windows. The cost of a wrong drop is a command found through the sibling `bin` or a later entry, never a new lookup source.
- Equivalent spellings (dot segments, a symlinked Volta home) do not pair, so the image dir stays. That is the behaviour before this change; canonicalising would make the result depend on the disk.
