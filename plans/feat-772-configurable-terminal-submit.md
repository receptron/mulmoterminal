# feat #772 — Configurable submit / newline byte mapping

## Problem

Whether Enter **submits** a prompt or inserts a **newline** is decided by Claude Code's
TUI from the *bytes* it receives, and that mapping is environment-dependent (a user can
rebind it in Claude Code). MulmoTerminal hardcodes the **standard** mapping in two
independent places:

- **Client keyboard** (`src/composables/useTerminalConnections.ts`): Enter → `\r`
  (native, = submit); Shift+Enter → `\x1b\r` (ESC+CR = Alt/Meta+Enter, = newline);
  Option+Enter → `\x1b\r` via `macOptionIsMeta`.
- **Server phone-submit** (`server/backends/remoteHost/terminalInput.ts`): after
  bracketed-paste, a hardcoded `\r` is sent to submit.

Users whose Claude reads the *reversed* mapping (`\r` = newline, `\x1b\r` = submit) get
Shift+Enter that submits (client) and a phone "send" that never submits (server).

## What various platforms can actually send (design basis)

- **PC keyboards (Mac/Win/Linux)**: full keydown with `shift/alt/ctrl/metaKey`.
  `Cmd+Enter` (metaKey) emits **no** PTY bytes in xterm (Cmd is OS/browser-reserved),
  so a "Cmd+Enter = submit" scheme is not portable — we do **not** use it.
- **Smartphones**: only a **bare Enter** is reliably producible (no Shift+Enter; Android
  IME often yields keyCode 229). But the phone's real input path is the **server
  remote-view** (paste + submit byte), not xterm — so the phone is served by the server
  fix, not by key chords.
- The single environment-dependent variable is **which byte submits**. One setting drives
  both the client key handler and the server submit.

## Design (chosen: single submit-byte toggle, config.json only, no UI)

New global config field `terminalSubmit: "cr" | "esc-cr"` (default `"cr"`).

| Mode | submit byte | newline byte | Enter | Shift+Enter | Option/Alt+Enter | phone submit |
|---|---|---|---|---|---|---|
| `cr` (default, standard Claude) | `\r` | `\x1b\r` | `\r` submit | `\x1b\r` newline | `\x1b\r` newline | `\r` |
| `esc-cr` (reversed Claude config) | `\x1b\r` | `\r` | `\x1b\r` submit\* | `\r` newline | `\r` newline | `\x1b\r` |

\* Enter interception in `esc-cr` is **skipped during IME composition** (`isComposing`),
so Japanese/CJK candidate-confirm is never eaten. In `cr` mode the bare-Enter path is
untouched (native xterm), so the default Mac behavior is byte-for-byte unchanged.

## Files

Shared:
- `common/terminalSubmit.ts` (new) — `TerminalSubmitMode`, `DEFAULT_TERMINAL_SUBMIT_MODE`,
  `isTerminalSubmitMode`, `submitSequence(mode)`, and the pure `enterKeyOverride(mode, e)`.

Client:
- `src/composables/terminalSubmitMode.ts` (new) — tiny mutable holder (`get/set`), no
  xterm dependency so `useAppConfig` can set it without pulling xterm into config tests.
- `useTerminalConnections.ts` — replace the Shift+Enter-only handler with the mode-aware
  `makeEnterHandler`.
- `useAppConfig.ts` — on `loadConfig`, `setTerminalSubmitMode` from `/api/config`.

Server:
- `config-schema.ts` / `app-config.ts` — add + sanitize + merge + expose the field.
- `config-routes.ts` — `getTerminalSubmit()` live getter.
- `remoteHost/terminalInput.ts` — send `deps.submitSequence?.() ?? "\r"` instead of `\r`.
- `remoteHost/handlers.ts`, `remoteHost/index.ts`, `server/index.ts` — thread the getter.

Tests: `test/common/terminalSubmit.spec.ts` (pure), plus additions to the terminalInput,
useTerminalConnections, useAppConfig, and app-config specs.

Docs: `docs/guide/{en,ja}/config.md` (thorough section + key table), `README.md`,
`docs/ChangeLog.md`.
