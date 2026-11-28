---
name: verify-mulmoterminal
description: Start a MulmoTerminal from THIS checkout on a scratch HOME, drive it in a real browser and tmux, collect evidence, and stop it without touching the maintainer's live tmux server. Use whenever a change in this repo has to be seen working in the running app rather than only in the specs — a UI change, a route or middleware every request passes through, a GUI MCP tool, anything CLAUDE.md's "wide blast radius" rule covers.
---

# Verify a change in a running MulmoTerminal

You are almost certainly running INSIDE a MulmoTerminal cell. The maintainer's live server holds
your own session and every cell they have open, under the tmux socket `-L mulmoterminal`. Stopping
it drops every cell to its not-started screen. Everything below exists so that the server you start
is a different one, and the one you stop is the one you started.

The helper `scripts/verify-scratch.ts` does the parts that can go wrong. Use it rather than typing
the commands it wraps: it refuses what the prose here would only warn about.

Pick a scratch HOME outside the repo (your scratchpad is right) and a free port, then keep both for
the whole run:

```bash
H=<scratch dir>/verify-home      # never the account's own home; the helper refuses it
P=47411                          # any free port; never 34567, the dev server's
```

## 1. Launch

```bash
yarn build                                   # the launcher serves dist/; start refuses a stale one
node --import tsx scripts/verify-scratch.ts start --home "$H" --port "$P"
```

It prints the URL, the launcher pid, the server log, and `socketPath`. That is the tmux socket this
server will create, computed from `$H` the same way the server does (`server/config/home-scope.ts`).
It refuses to start when:

- `dist/` is older than `src/`. The page would be the previous build's, and "it works" would be about
  code you did not change.
- something already answers on the port. That process is not evidence about this checkout.

It also writes `$H/.zshrc` with a short prompt, so the account name and host stay out of screenshots.

Do not start an agent (claude, codex) in a cell on this server. Under a scratch HOME, codex has
opened its update screen and started `brew upgrade` by itself, and claude cannot log in. A Shell
cell covers terminal, pane and MCP checks.

## 2. Doctor

```bash
node --import tsx scripts/verify-scratch.ts doctor --home "$H"
```

It exits non-zero unless the server answers, the launcher runs in THIS checkout, and the client build
is fresh. `scratchTmuxRunning` stays false until the first cell opens. Run it again after anything
that could have restarted the server.

## 3. Drive

**Open a Shell cell and type into it.** This repo has no Playwright dependency. Use any installed
copy: the Playwright MCP when it can launch a browser, or another checkout's `node_modules`.

```bash
node .claude/skills/verify-mulmoterminal/drive-shell.mjs <dir holding node_modules/playwright> "$H" "$H/shell.png"
```

It reads the port and socket from `start`'s state file. It clicks `[data-testid=agent-picker-shell]`
and then `[data-testid=cell-dir-go]`, types `echo VERIFY_MARKER_3593`, and saves a screenshot. Copy
it as the start of your own drive script.

The terminal is drawn on a canvas, so the page has no text to wait on. Wait on tmux instead — the
session appearing, the output reaching `capture-pane` — never on a fixed delay.
Do every check in the SAME browser session that opened the cell: a new browser starts on an empty
grid.

Text typed into a Shell cell RUNS, so keep payloads harmless (`echo <marker>`).

**Call a GUI MCP tool without an agent.** The cell's session id is the `mt-<id>` from
`tmux -S <socketPath> ls`. POST JSON-RPC to `/api/mcp/<id>` in this order:

1. `initialize`
2. `notifications/initialized`
3. `tools/call`

Send `accept: application/json, text/event-stream`, and send back the `mcp-session-id` header the
first answer hands you. The pane opens with the result in the browser that has the cell open.

## 4. Evidence

Diff against what the system itself reports, not against another output of yours:

- **The terminal screen** — `tmux -S <socketPath> capture-pane -p -t mt-<id>`. Use the ABSOLUTE
  `socketPath` from `start`, never `-L`.
- **The page** — a screenshot from the drive script.
- **The server's side** — `$H/server.log`, and `curl -sD - http://127.0.0.1:$P/<route>` for
  headers, such as a presented page's CSP.

In the PR, say what you drove and what you could NOT exercise here, and why. Leaving it out reads as
"the run covered everything". Mask paths and names before posting a screenshot.

## 5. Cleanup

```bash
node --import tsx scripts/verify-scratch.ts stop --home "$H"
tmux -S "$(dirname <socketPath>)/mulmoterminal" ls | wc -l   # read-only: the live sessions are all still there
```

`stop` signals the launcher it started only while that pid still runs in this checkout. It stops tmux
only through the socket computed from `$H`. Any other socket — the live one, another scratch HOME's,
a bare `-L` name — is refused (`scripts/verify-scratch-plan.ts`, pinned by
`test/scripts/verify-scratch-plan.spec.ts`). It exits non-zero while the server still answers or its
tmux still runs.

A socket FILE can outlive its server, so "the file is gone" is not the test. `stop` reports
`scratchTmuxRunning`, from asking tmux.

Never clean up by hand with `tmux kill-server`, `tmux -L mulmoterminal …`, or
`TMUX_TMPDIR=… tmux -L mulmoterminal …`. Each of these has stopped the live server (CLAUDE.md, "Never
stop a tmux server you did not name by absolute path").

## Keeping this skill true

When a run here fails for a reason the skill did not predict, fix the skill in the same PR as the
change you were verifying:

- a selector that moved;
- a new precondition;
- a check `doctor` should have made.

A step that only works from memory is not in the skill yet.
