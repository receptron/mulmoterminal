# feat: psmux as the way to get persistent sessions on Windows (#3117)

## Goal

On Windows, [psmux](https://github.com/psmux/psmux) installs itself as `tmux.exe`, so MulmoTerminal
already takes the tmux path when it is on `PATH`. Make that path work correctly on psmux 3.4.0+
without changing anything for a real tmux.

Reference: the fork highfar-projects/mulmoterminal, which has run on psmux for weeks. Only the
items the issue says still matter on psmux 3.4.0 are taken.

## Detection

psmux answers `tmux -V` with `tmux 3.x` on the first line and `psmux 3.4.0 (...)` on the second.
`server/infra/process/psmux.ts` (pure) reads that: `isPsmuxVersion`, `psmuxVersionOf`,
`psmuxVtInputFor`. `tmux.ts` caches the answer next to `cachedAvailable` and exposes
`tmuxIsPsmux()` / `tmuxPsmuxVtInput()`. With a real tmux both are false and every call site below
takes the branch it takes today.

## What changes on psmux

| issue item | change |
|---|---|
| 1, 2: Enter after a paste lands inside it; two Esc arrive as one | the psmux client is spawned with `PSMUX_VT_INPUT=1` (psmux 3.4.0+, psmux#766). `PSMUX_VT_INPUT=0` in the server's env opts out |
| 4: emoji width | `/api/config` carries `terminalUnicodeVersion` (`"11"` on psmux, `"6"` otherwise); the browser's xterm loads `@xterm/addon-unicode11` and activates the version it is told. A real tmux keeps `"6"`, i.e. xterm's default |
| 5: Volta's `_VOLTA_TOOL_RECURSION` | taken out of every cell's environment by the shared sanitizer (#3233): direct spawns, real tmux, psmux and throwaway probes; a server already running at startup is scrubbed too |

A psmux older than 3.4.0 gets a startup warning naming the version to upgrade to; no workaround for
3.3.x is carried (the fork's 3.3.8 fixes — key-event input encoding, 1000 ms submit delay, wheel
binding split, `list-clients` parsing — were fixed in psmux 3.4.0 or by the VT route).

## Not taken (deliberately)

- The fork's `terminal-features` filter for the conf and the one-row client-size correction: measured
  on 3.3.8 only and not in the issue's 3.4.0 list. Revisit with a 3.4.0 measurement.
- Fork-only diagnostics (`tmux-trace`).

## Docs

README (requirements table, Session persistence), `docs/guide/{en,ja}/getting-started.md`
(tmux section, tables, troubleshooting), `docs/terminal-notes.md` (Unicode width), the CLI doctor's
tmux hint.

## Verification

- Unit specs for the pure detection and version gate, the config field, the env scrub.
- `yarn format / lint / build / typecheck / test`.
- No Windows machine here: psmux behaviour itself is not exercised locally; the real-tmux path is
  checked to be unchanged (the flags are false and the specs pin that).
