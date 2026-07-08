# Phase 4b-1 — `run:"shell"` header buttons (execute a command)

Follow-up to the merged header PR (#285). Makes `run:"shell"` header buttons actually run their command,
reusing the existing **command-cell** mechanism (like the ▶ Run menu). Chip management (4b-2) is a
separate PR and is out of scope here.

## Goal

Clicking a `run:"shell"` header button runs its `cmd` (with `${var}` substitution) in a command cell —
single view hands off to a grid command cell (same as the Run menu), grid cells open a spare cell.

## Security model (the crux)

- **The browser never receives the resolved command.** `/api/header` stops sending `cmd` to the client
  entirely. A shell button carries only `{id, label, emoji/icon, run:"shell"}`.
- On click the client sends the **button id** (+ the session context it already has: cwd/session/agent/
  model) to `/ws/run`. The server re-loads the merged config, rebuilds the context, finds the button by
  id, checks `run:"shell"` and its `when`, and resolves `cmd`.
- **`${var}` values are shell-escaped** (single-quote wrap, platform-aware) before substitution into the
  command string, so a branch/repo/task containing shell metacharacters (`a; rm -rf`) can't inject. The
  command *template* is trusted config; only the substituted values are escaped.
- This mirrors `/ws/run?index=` (the browser sends an index into `script.json`, never a raw command).

## Server

- `server/header-resolve.ts`
  - `resolveHeader`: **stop dropping** `run:"shell"` buttons (they now dispatch).
  - `resolveButton`: **omit `cmd`** from the resolved output (never leak the command to the client).
  - add `substituteShell(text, ctx, quote)` — like `substitute` but each `${var}` value is passed through
    `quote`.
  - add `resolveButtonCommand(config, ctx, buttonId, quote)` — find the shell button by id whose `when`
    passes, return its shell-escaped resolved `cmd`, else `null`.
- `server/index.ts`
  - `shellQuoteFor(platform)` — POSIX `'…'` with `'\''` escaping; PowerShell `'…'` with `''` escaping.
  - `runWss` connection: if `?buttonId=` is present, resolve via `loadHeaderConfig` + `buildHeaderContext`
    (+ `shellQuoteFor`) and `spawnCommandPty(command, cwd, ws)`; otherwise the existing `?index=` path.
    Same `handleCommandFrame` / close-kills-pty wiring.

## Client

- `src/components/wsUrl.ts` — `buildRunWsUrl` accepts either `{index}` or
  `{buttonId, session, agent, model}` (+cwd), building `/ws/run?buttonId=…&cwd=…&session=…&agent=…&model=…`.
- Shared `RunCommand` type (discriminated union), label + cwd common to both:
  - `{ source:"script"; index; label; cwd }`
  - `{ source:"button"; buttonId; label; cwd; session; agent; model }`
  Widen `Cell["command"]`, `PendingCommand`, the connection target's `command`, and Terminal's `command`
  prop to `RunCommand`. Pass-through sites (gridTabs/CommandCell/TerminalGrid/GridView) are unaffected —
  only URL-building branches on `source`.
- `src/components/Terminal.vue` — a `run:"shell"` button **emits `run`** with a `source:"button"` payload
  (buttonId + slot's session/agent/model/cwd), instead of the `runHeaderButton` no-op. `input`/`open`
  keep going through `runHeaderButton`.
- `src/composables/useHeaderButtons.ts` — drop `cmd` from the client `HeaderButton` type (server no longer
  sends it).

## Default == today

Unchanged: no `buttons` config ⇒ nothing new. A shell button only appears when configured; clicking it
opens a command cell (the existing UX for Run). No behavior change to input/open buttons or chips.

## Tests

- `header-resolve.spec.ts`: shell buttons are kept (not dropped); `resolveButton` omits `cmd`;
  `resolveButtonCommand` returns the escaped command and `null` for a bad id / failing `when`;
  `substituteShell` escapes metacharacters.
- `wsUrl.spec.ts`: button variant builds the right `/ws/run?buttonId=…` URL.
- shell-quote unit: `a; rm -rf $(x)` → safely single-quoted.
