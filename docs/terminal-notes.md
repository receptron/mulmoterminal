# Terminal notes (developer reference)

Everything the terminal does that isn't obvious from the code, why it's there, and **what to
re-check when a dependency is upgraded**. The terminal has been the source of a long tail of
subtle bugs (selection, scrolling, links, copy/paste, key handling) because it straddles four
layers — each with its own quirks — and a change in any one can silently break another.

> If you touch xterm, an xterm addon, tmux, node-pty, or the Claude Code version, read the
> **[Upgrade regression checklist](#upgrade-regression-checklist)** at the bottom first.

## The stack

```
browser  ── @xterm/xterm (canvas renderer, addons)   src/composables/useTerminalConnections.ts
   │  WebSocket  { type:"input"|"output"|... }        src/components/Terminal.vue
server   ── node-pty  ── tmux (persistence)  ── agent (claude / codex / $SHELL)
              server/session/*.ts               server/infra/tmux.ts
```

- The **browser** runs xterm.js. Its durable runtime (socket + xterm instance) lives in the
  module-singleton manager `useTerminalConnections.ts`, independent of the Vue component, so a
  session survives view switches / unmounts (see the file header).
- The **server** raw-forwards PTY output to the socket (`term.onData → sendFrame({type:"output"})`
  in `server/session/spawn-*.ts`) and writes socket input to the PTY. It is a dumb pipe for live
  I/O — it does **not** re-serialize through the headless emulator, so escape sequences pass
  through byte-for-byte.
- **tmux** wraps every persistent session so it outlives the server process. This is where a lot
  of the surprises come from — see [The tmux passthrough rule](#the-tmux-passthrough-rule).

## Version pins that matter

| Package | Pin | Why it's load-bearing |
|---|---|---|
| `@xterm/xterm` | `^6.0.0` | 6.0 changed the scrollbar (VS Code-style overlay) and internals. The DOM/link/scroll code assumes 6.x. |
| `@xterm/addon-canvas` | `^0.7.0` | ⚠️ **Peers on `@xterm/xterm@^5`** — an xterm-5 renderer running on xterm-6. There is **no stable xterm-6 canvas addon** (even `0.8.0-beta` peers `^5`). Suspected cause of the scrollbar / selection-auto-scroll problems (#782). See [Renderer](#renderer-canvas-vs-dom). |
| `@xterm/addon-web-links` | `^0.12.0` | Linkifies visible `http(s)://` URLs. |
| `@xterm/addon-clipboard` | `^0.2.0` | OSC 52 clipboard write (auto-copy → browser clipboard). |
| `@xterm/addon-fit` | `^0.11.0` | Size the grid to the container. |
| `node-pty` | `^1.1.0` | The PTY. |
| tmux | 3.4+ at runtime | OSC 8 hyperlink forwarding (`terminal-features hyperlinks`) needs 3.4+. Measured on 3.6a. |

## Configured behaviors (and the issues behind them)

### xterm `Terminal` options — `useTerminalConnections.ts`

- `macOptionIsMeta: true` (#265/#266) — macOS Option acts as Meta so Claude's Alt bindings reach
  the PTY (Alt+Enter newline, Alt+B/F word nav). Cost: Option dead-key accents don't work.
- `macOptionClickForcesSelection: true` (#729) — on macOS, **text selection requires Option+drag**
  (mouse-tracking apps otherwise capture the drag). Without this a Mac can't select at all.
- `allowProposedApi: true` — `term.parser` is proposed API and throws without it (used by the
  mouse-tracking guard).
- `linkHandler` (#783/#785) — opens OSC 8 hyperlinks (e.g. Claude's statusline `PR #123`) on
  click, restricted to `http(s)://` (a program could emit a `javascript:` link). Without it xterm
  falls back to a `confirm()` dialog. **Necessary but not sufficient** — see the tmux rule.
- `fontSize` (#860) — no longer a constant. Resolved per terminal as **dir pin
  (`.mulmoterminal.json` `fontSize`) → app-wide Settings value (`localStorage.terminalFontSize`) →
  `TERMINAL_FONT_SIZE_DEFAULT`**, and clamped to 8–32 by `normalizeFontSize`
  (`common/terminalFontSize.ts`), which both sides share.
  **Anything that changes it MUST re-fit.** The size changes the cell metrics, so `cols`/`rows`
  change and the PTY has to be told — `setFontSize()` therefore calls `fitAndSyncSize()`, and
  `attach()` applies a changed size *before* its own fit. Setting the option alone reproduces the
  bug that made browser zoom useless as a workaround in #860: xterm's grid and the PTY disagree,
  so the cursor and the wrap points drift. `Conn.font` remembers the applied value so a
  rebuilt terminal (#846) doesn't snap back to the default.
- `fontFamily` (#864) — also no longer a constant, and it travels WITH the size as one
  `TerminalFont { size, family }`, because both decide the cell metrics and both therefore have to
  re-fit: `setFont()` is the single path, and a change to both costs one fit rather than two.
  Resolved per terminal as **dir pin (`.mulmoterminal.json` `fontFamily`) → global config
  (`fontFamily` in `~/.mulmoterminal/config.json`) → `TERMINAL_FONT_FAMILY_DEFAULT`**, validated by
  `normalizeFontFamily` (`common/terminalFontFamily.ts`), which both sides share.
  Global rather than per-browser (which is where the SIZE lives) because it names fonts, and which
  fonts are installed is a property of the host, not of the phone or laptop looking at it. That
  makes hydration async — `/api/config` can land after a terminal mounts — so `globalFontFamily` is
  a ref that `Terminal.vue` watches, and the late value re-fits rather than being missed.
  The default stack ends in CJK faces (JP first, then KR/SC/TC): xterm reserves exactly two cells
  for a fullwidth character, and the face a browser picks for an unnamed glyph is not required to
  be em-square, so leaving CJK to the generic `monospace` fallback tears box-drawing frames.

### Submit vs newline — `terminalSubmit` (#772/#780)

Whether Enter submits or inserts a newline is decided by Claude Code from the received **bytes**,
and that mapping is environment-dependent. `terminalSubmit` (`"cr"` default / `"esc-cr"`) picks
which byte submits; it drives the browser key handler **and** the phone remote-view submit, scoped
to Claude sessions only (shell/codex keep plain CR). See the [config guide](guide/en/config.html#terminal-submit).
The `esc-cr` bare-Enter interception is guarded on `isComposing` so IME confirm isn't eaten.

### Links — three independent mechanisms

| Kind | Where | Recognizes |
|---|---|---|
| Local file path (#778) | `terminalFilePathLinkProvider.ts` (`registerLinkProvider`) | a token with a `/` and a file extension, scoped to the session cwd → the **Files pane** beside an enlarged cell when it can show that kind and the path is under that cell's dir (#910), else **routed by extension** (#808–#811): rendered/indented/table routes, the in-app Files view, or `/api/files/raw` as the fallback |
| OSC 8 hyperlink (#783/#785) | `linkHandler` + xterm core `OscLinkService` | arbitrary text → URL (Claude statusline `PR #NNNN`) — **requires the tmux `hyperlinks` feature** |
| Plain URL | `WebLinksAddon` | visible `http(s)://` URLs |

The per-extension routing table is **not** repeated here — it belongs to the file routes and
the Files view, not to this stack, and nothing in it breaks when xterm or tmux is upgraded.
It lives in [README → Clicking a file path](https://github.com/receptron/mulmoterminal#clicking-a-file-path);
change one and change the other (#834).

### Mouse tracking & selection — `guardMouseTracking` (#729/#737/#845)

- SET of a mouse-tracking mode (`CSI ? … h`, e.g. 1000/1002/1003/1006) is **swallowed** so a drag
  stays a text selection instead of the app's coordinate reports landing in the prompt (#729).
- The swallow takes the whole mouse away from the app, so **the wheel and clicks are synthesized
  back** (`src/composables/terminalMouseInput.ts`; the rules are pure in `mouseReports.ts`). Both
  fire only in the alternate buffer, and only for an app that asked for tracking + SGR (1006):
  - **Wheel** (#737) — xterm's fallback turns it into ↑/↓ arrows, which a TUI binds to input
    history, so scrolling spun the prompt. That fallback is still what an app which never asked
    for tracking gets (and the spec pins it) — the report only replaces it for one that did.
    **Deltas are accumulated into whole notches** (`wheelNotches`), not reported one per event:
    a macOS trackpad emits a burst of a few pixels per event, and one detent each scrolled a TUI
    an order of magnitude faster than the same swipe scrolls the normal buffer (#978). The
    conversion mirrors xterm's own (`deltaY / cellHeight`, fraction banked across events), so both
    buffers travel the same distance. An event worth less than a notch is still **consumed** —
    handing the leftover back would resurrect the ↑/↓ fallback. The user's `terminalScrollSpeed`
    multiplier scales this and xterm's `scrollSensitivity` together, so one Settings control
    covers both paths.
- **The notch rate and tmux's copy-mode step are a matched pair** (#978). Under tmux — which is
  every persistent session — the wheel report goes to *tmux*, not to the program: a pane with no
  mouse mode of its own (a plain shell) makes tmux enter copy-mode, whose default is `send -X
  -N 5 scroll-up`. Five lines per report is the "it jumps a paragraph at a time" complaint. So
  `WHEEL_SCROLL_BINDINGS` (server/infra/tmux.ts) rebinds it to **one line**, and
  `TRACKPAD_GAIN = 1.5` (mouseReports.ts) raises the notch rate to keep the same overall speed
  — 1.5 lines per cell of finger travel. **Change one and the scroll SPEED changes**, not just
  its smoothness. A pane running a mouse program (Claude Code) never reaches copy-mode (tmux
  `send -M` forwards the report), so its step is the program's own and only the rate applies.
  - **Click** (#845) — a press and release that stayed put becomes an SGR press/release pair, so
    the app's own click targets ("Jump to bottom", "1 new message") respond. Nothing is
    `preventDefault()`ed, so xterm's selection is untouched.
- **The browser side wins every gesture the app's click would compete with.** No report is sent
  when:
  - the pointer moved (a drag is a selection — the reason the swallow exists);
  - the pointer **left** the screen element between press and release. The pending press is
    dropped there, or a later release landing back inside would be measured against it and report
    a click that never happened;
  - the gesture **left a selection behind** — a double-click's word, a triple-click's line. (The
    first click of a double-click still reports: nothing is selected yet.);
  - a **link is under the pointer** — xterm marks the screen element `xterm-cursor-pointer` while
    a link is hovered, and that click already has an owner (the link's activate handler).
- The swallowed modes are per-session and cleared on `term.reset()`.
- xterm exposes no pixel-to-cell mapping, so cell coordinates are derived from `.xterm-screen`'s
  own box. Reaching into `_core._renderService.dimensions` instead would need an `any`.

### A terminal xterm has killed can only be replaced (#846)

`Buffer.resize` in xterm 6.0.0 can finish with fewer lines than the viewport needs
(upstream [xtermjs/xterm.js#6063](https://github.com/xtermjs/xterm.js/issues/6063), **unfixed**);
the next write to a bottom row then throws in `lineFeed` / `_eraseInBufferLine`, which dereference
`lines.get(…)` with no null check. Three things about that failure decide how it is handled here —
all confirmed against `@xterm/headless@6.0.0` by reproducing the upstream flight-recorder state:

- **The throw is out of reach.** It happens inside the WriteBuffer's own `setTimeout`, not under
  our `term.write()` call, so no try/catch of ours can see it. The state has to be found by
  looking, not by catching — hence the probe in `terminalBufferHealth.ts`, run on `fit()` and on
  each output message.
- **The write queue stays stuck forever.** `WriteBuffer.write()` only starts the drain when the
  queue *was* empty, so the entries a throw left behind are never parsed. This is why the cell
  freezes until a page reload.
- **`term.reset()` does not clear it.** Reset rebuilds the buffers (so the buffer invariant is
  restored) but leaves the write queue stuck — a terminal that has thrown never processes input
  again. `connect()` alone is therefore not a repair: the slot needs a **new `Terminal`**, which
  is what `rebuildTerminal()` does before re-attaching. The session is server-side, so the replay
  brings the content back and the user sees the cell blink.

Rendering itself survives: `RenderDebouncer._innerRefresh` clears its animation frame *before*
calling the render callback, so a renderer that throws still repaints on the next refresh.

### Renderer (canvas vs DOM)

The **canvas renderer** (`@xterm/addon-canvas`, added to fix CJK glyph drift — long Japanese lines
spilling off the right edge with the DOM renderer) draws each glyph in a fixed cell. But the addon
is xterm-5-era on xterm-6 (see the version table), and is the suspected cause of #782. See the
CAVEAT comment at the `loadAddon(new CanvasAddon())` site. **Debugging note:** the canvas renderer
paints to `<canvas>`, so terminal text and link decorations are **not in the DOM** — headless
inspection (`.xterm-rows`, `elementFromPoint`) sees nothing. To debug links/selection headlessly,
force the DOM renderer or observe effects (`window.open`, buffer state) instead of reading the canvas.

### Live output, replay, and query stripping

- Live output is raw-forwarded. On **reattach**, the server replays a bounded tail
  (`entry.buffer`) through `stripTerminalQueries` (`terminal-replay.ts`) so xterm doesn't re-answer
  device queries (a DA reply would surface as `0;276;0c` in the prompt).
- The replay buffer tail is sliced carefully so a cut never lands inside an escape sequence (#434),
  and is sized (~1 MiB) so scrollback survives a reattach (#776).

## The tmux passthrough rule

**This is the single most important gotcha.** tmux only forwards a program's advanced terminal
sequences to the outer terminal (our xterm) when told the outer terminal supports them. Two cases
have already bitten us, with the **same shape**:

| Feature | What breaks without it | Fix in `server/infra/tmux.ts` | Issue |
|---|---|---|---|
| OSC 52 clipboard | Claude's auto-copy never reaches the browser clipboard | `terminal-overrides` `Ms` capability | #206 |
| OSC 8 hyperlinks | Claude statusline `PR #NNNN` (and any OSC 8 link) isn't clickable | `set -as terminal-features '*:hyperlinks'` | #783 |

**If a future Claude Code / codex version starts emitting a new OSC/terminal feature (sixel,
notifications, kitty keyboard, OSC 7 cwd, …) and it "doesn't work through the app but works in a
bare terminal", suspect tmux stripping it first** — add the corresponding `terminal-features` flag
or `terminal-overrides` capability. The isolation test: write the sequence **directly to xterm**
(bypassing tmux); if it works there but not through a session, tmux is the culprit.

## Known issues / open items

- **#782 — scrollbar not shown / selection doesn't auto-scroll** (open). Likely the xterm-5 canvas
  addon on xterm-6, but the scrollbar (auto-hide VS Code overlay) reproduced on the DOM renderer
  too, so it may be two roots. Fix is a renderer decision (WebGL vs DOM), which needs on-device QA
  (CJK drift, scrollbar, selection). See #782 for the full analysis.
- **Selection & copy/paste** — several sharp edges:
  - macOS: selection is **Option+drag** (`macOptionClickForcesSelection`), not plain drag.
  - You can only select what's on screen: a Claude/Codex TUI runs in the **alternate buffer**,
    which has no xterm scrollback, and the normal-buffer selection **auto-scroll is broken** (#782)
    — so copying more than the visible screen isn't possible today.
  - Copy (auto): Claude's OSC 52 auto-copy works only via the tmux `Ms` override + `set-clipboard
    on` (#206). Paste uses the browser's native Cmd+V into xterm (there is no app paste button).
- **Phone submit** — the submit byte is env-dependent (`terminalSubmit`, #445/#772); the sanitizer
  strips control bytes so phone input is single-line.

## Upgrade regression checklist

When bumping **xterm / an xterm addon / tmux / node-pty / the Claude Code version**, re-verify the
matrix below. Most of these **cannot be caught by unit tests** (they need a real terminal + a human
looking) — flag them for QA on the release.

| Area | Check in code | Needs user QA |
|---|---|---|
| Renderer / CJK | canvas addon still loads; `@xterm/addon-canvas` peer vs `@xterm/xterm` major (mismatch = red flag) | long Japanese line doesn't drift off the right edge |
| Scrollbar / selection | — (no unit coverage) | scrollbar visible + synced; Option+drag selects; selection auto-scrolls past the visible screen (#782) |
| OSC 8 links | tmux `terminal-features '*:hyperlinks'` present; xterm `linkHandler` set | click Claude statusline `PR #NNNN` → opens the PR (no confirm dialog) |
| OSC 52 clipboard | tmux `Ms` override + `set-clipboard on` present (`planMsOverride`) | Claude auto-copy reaches the browser clipboard |
| File-path links | `registerFilePathLinks` order vs WebLinks; `/api/files/raw` cwd containment | click a generated file path → previews the file |
| Enter / newline | `terminalSubmit` mapping + `isComposing` guard; `macOptionIsMeta` | Enter submits, Shift+Enter newlines; IME confirm not eaten; both `cr` and `esc-cr` |
| Mouse / wheel | `guardMouseTracking` swallow set (1000/1002/1003/1006); wheel→SGR in alt buffer; `wheelNotches` accumulation vs xterm's own `consumeWheelEvent` | wheel scrolls transcript (not prompt history); drag selects, doesn't emit mouse reports; a trackpad swipe moves a TUI about as far as it moves the scrollback |
| Reattach | `stripTerminalQueries` patterns; replay buffer size | reattaching a session doesn't leak `0;276;0c`-style junk; scrollback survives |

**Fast isolation techniques** (learned the hard way):
- A terminal behavior that works on a **direct `term.write()`** but fails through a live session ⇒
  the **transport (usually tmux)** is stripping/transforming it, not xterm.
- The **canvas renderer hides text from the DOM** — force the DOM renderer (or observe `window.open`
  / buffer state) to debug links/selection headlessly.
- A "works in a bare terminal, not in the app" report ⇒ check the tmux `terminal-features` /
  `terminal-overrides` first.

## Related

`docs/spawn-architecture.md` (session lifecycle), `docs/gui-protocol-spike.md`,
`docs/remote-host-protocol.md` (what the phone can ask of a session),
`src/composables/useTerminalConnections.ts`, `server/infra/tmux.ts`, `server/session/*.ts`.
Issues: #206, #263/#264/#293, #265/#266, #434, #445, #572, #729, #737, #772/#780, #776, #778, #782, #783/#785.
