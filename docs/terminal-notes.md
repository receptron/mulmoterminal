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
              server/session/*.ts               server/infra/process/tmux.ts
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
| `@xterm/addon-canvas` | `^0.7.0` | **Peers on `@xterm/xterm@^5`** — an xterm-5 renderer running on xterm-6, deliberately. There is **no xterm-6 canvas addon** (even `0.8.0-beta` peers `^5`), so this cannot be repaired by bumping. It is not known to break anything; it was once blamed for #782/#783 and measurement cleared it. See [Renderer](#renderer-canvas-vs-dom) for what to move to when an xterm bump does break it. |
| `@xterm/addon-web-links` | `^0.12.0` | Linkifies visible `http(s)://` URLs. |
| `@xterm/addon-clipboard` | `^0.2.0` | OSC 52 clipboard write (auto-copy → browser clipboard). |
| `@xterm/addon-fit` | `^0.11.0` | Size the grid to the container. |
| `@xterm/addon-unicode11` | `^0.9.0` | Registers the Unicode 11 width table — the fallback when `/api/config` carries no `terminalWidthTable` (no tmux, a psmux whose samples disagree, or before the boot probe ends). |
| `node-pty` | `^1.1.0` | The PTY. |
| tmux | 3.4+ at runtime | OSC 8 hyperlink forwarding (`terminal-features hyperlinks`) needs 3.4+. Measured on 3.6a. |
| psmux (Windows) | 3.4.0+ | Answers `tmux -V` as `tmux 3.x` and names itself on the second line (`server/infra/process/psmux.ts`). 3.4.0 is the first with `PSMUX_VT_INPUT`, which the client is started with. |

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

### Character widths — measured from tmux (#3117, #3173, #3180)

tmux decides how many columns each character takes and places everything after it from that
answer; when the browser's xterm counts differently, the rest of the row is drawn off by the
difference (`[✅]` loses its `]` under the glyph, a table's right border wanders). No fixed table
agrees with every tmux — the answer comes from utf8proc or the C library, `codepoint-widths`, and
the tmux version — so the server asks.

At boot (`server/infra/process/tmuxWidthProbe.ts`) a throwaway tmux server on an absolute `-S`
socket, in the environment a session gets, answers `#{w:#{l:…}}` for every codepoint; the answers
become runs of non-1 widths (`common/tmuxWidthTable.ts`). tmux also folds sequences into one cell —
a variation selector, a ZWJ family, a skin tone, a flag — by a rule that changed between releases.
`common/tmuxClusters.ts` mirrors `screen_write_combine` as tmux 3.6a, tag 3.6 and 3.4/3.5 have it; a few
sample sequences are printed in the throwaway pane, and the first rule whose predictions all of them
match is used. When none matches, sequences are counted per character. `/api/config` carries the result as
`terminalWidthTable`, and the browser registers it with xterm as its own Unicode version
(`common/tmuxUnicodeProvider.ts`). With no table it falls back to `terminalUnicodeVersion: "11"`,
which agrees with tmux and Claude Code far more often than xterm's default `"6"`. A page whose config carried no table (the tab `npx mulmoterminal` opens
usually reads it before the measurement ends) asks `/api/config/terminal-widths`; the server answers
when the measurement ends, within a bound. The page adopts the answer only if no newer config set the
table meanwhile, and asks again after a failed request. Open terminals switch to the table, and each
sends a `redraw` frame so tmux repaints the cells xterm already parsed. The table is also
dropped when the live `-L mulmoterminal` server is a different tmux version from the one measured
(a server that outlived an upgrade), since that server is the one laying out the reattached sessions.

psmux (#3180) cannot be measured the same way: `#{w:}` answers with a codepoint count, and
`respawn-pane -k` drops the session. Its widths are those of the Rust crate it counts with,
`unicode-width`, generated into `common/psmuxWidthRuns.ts` by `scripts/psmux-widths` (regenerate when
psmux moves the crate); its fold rule is the `psmux` one in `tmuxClusters.ts`, tmux 3.6a's except
that a flag takes no third regional indicator. Before either is used, the probe prints a set of
samples in a throwaway psmux server, one session each, and reads `#{cursor_x}`; any disagreement
leaves psmux on Unicode 11.

Every rule also stops folding once a cell is full: tmux holds at most `UTF8_SIZE` bytes in one cell
(21 in 3.4 and 3.5, 32 from 3.6) and psmux `MAX_CELL_BYTES` (32). A fold past that is refused after
every other check, so a long ZWJ sequence starts a new cell (#3194). The cell's byte count rides in
the provider state, which is why the state keeps only the kind of a cell's first codepoint rather
than the codepoint itself.

`test/server/infra/process/tmuxWidthProbe.spec.ts` is the check that matters: a real tmux, a client
attached through a PTY, and the bytes it receives fed to xterm with the table — every marker must land
where `#{cursor_x}` says tmux put it. It is skipped where tmux is absent.

### Submit vs newline — `terminalSubmit` (#772/#780)

Whether Enter submits or inserts a newline is decided by Claude Code from the received **bytes**,
and that mapping is environment-dependent. `terminalSubmit` (`"cr"` default / `"esc-cr"`) picks
which byte submits; it drives the browser key handler, the phone remote-view submit **and** the
spawn-time `initialPrompt` injection (`session/spawn/draft-injection.ts`, #1148 — it had a hardcoded CR,
so a seeded prompt was typed and never sent on an `esc-cr` host), scoped
to Claude sessions only (shell/codex keep plain CR). See the [config guide](guide/en/config.html#terminal-submit).
Anything auto-submitted also ends its line with a space (`submittableLine`, #1142), or an open
`/command` / `@path` completion menu eats the submit — on **either** mapping.
The `esc-cr` bare-Enter interception is guarded so IME confirm isn't eaten — in **two** places, and
both are needed. `enterKeyOverride` refuses `e.isComposing`, which is the Chrome / Firefox shape; the
custom key handler additionally refuses `isImeConfirming(e)` (`src/composables/imeComposition.ts`),
because **Safari fires `compositionend` BEFORE the confirming keydown** and the flag is already false
by then — so on Safari the pure guard alone submitted the half-converted line (#1353). The same
handler covers the keymap and clipboard paths, and the grid's window-level shortcut listener asks the
same question.

### Links — three independent mechanisms

| Kind | Where | Recognizes |
|---|---|---|
| Local file path (#778) | `terminalFilePathLinkProvider.ts` (`registerLinkProvider`) | a token with a `/` and a file extension — in a cell whose cwd is a Windows path, also `\` and a drive (`C:\x\a.md`), handed on `/`-separated (#3236); a path with a space in a folder name only when quoted, backticked or bracketed and reading as one anchored path (not a command line), as in `Read(/Users/me/My Docs/a.md)` (#3246) — (plus a `:line[:col]` / `(line,col)` suffix, which opens the text at that line, #2573), scoped to the session cwd → the grid's **Files pane** (beside an enlarged cell, or one already open beside the tiled grid) when it can show that kind and the path is under its cell's dir (#910), else **routed by extension** (#808–#811); a page, image, PDF, video or audio file outside the cell opens through a one-file grant (`/api/files/grant` → `/api/files/granted/…`, #3024), never by widening `/api/files/raw`: rendered/indented/table routes, the rendered-page route for `.html` (#2560), the in-app Files view, or `/api/files/raw` as the fallback. A type the BROWSER cannot display (`.xlsx`, `.zip`, an extensionless `Makefile`) goes to the Files view too rather than to a tab that would silently download it (#2038) |
| OSC 8 hyperlink (#783/#785) | `linkHandler` + xterm core `OscLinkService` | arbitrary text → URL (Claude statusline `PR #NNNN`) — **requires the tmux `hyperlinks` feature** |
| Plain URL | `WebLinksAddon` | visible `http(s)://` URLs |

A right-click on a file-path link opens the app's own menu (#3238): the provider's `ILink.hover` /
`leave` callbacks track which link the pointer is over, and a `contextmenu` listener on
`term.element` (`terminalFileLinks.ts`) hands that link to the one `TerminalLinkMenu` mounted in
`App.vue`. Off a link the event is not prevented, so the browser's menu (paste) stays.

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
    **The notches are counted, not just sent** (`WheelScrollControl.restoreToBottom`, #1546): the
    app owns its scroll position and never reports it, so the running total of notches this side
    reported is the only measure of how far above the bottom the app is. On submit that debt is
    paid back as wheel-DOWN reports, which is what makes Enter return to the latest output for a
    full-screen agent — `term.scrollToBottom()` cannot, there being no xterm scrollback in the
    alternate buffer. A shell needs none of this: with no tracking the wheel reaches tmux, and
    copy-mode's own Enter cancels back to the bottom.

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
  `WHEEL_SCROLL_BINDINGS` (server/infra/process/tmux.ts) rebinds it to **one line**, and
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

### A pane in tmux copy-mode takes every key (#2207)

A program that asks for no mouse tracking (a shell, Codex's inline screen) gets the wheel and a drag
from tmux's root bindings, which enter **copy-mode** (`copy-mode -e` / `copy-mode -M`) when neither
`alternate_on` nor `mouse_any_flag` is set. From then on every key goes to tmux — under
`mode-keys vi`, hjkl move a cursor — and the program receives nothing.

- **Detected by asking, after input.** tmux announces no mode change, and only input moves a pane
  in or out of copy-mode, so `server/session/pty/pane-mode-watch.ts` probes `#{pane_in_mode}` for the
  one pane that just received an `input` frame (also on view-activate and reattach), settled and
  ticketed. A `paneMode` frame reaches the browser only when the answer changes; `Terminal.vue`
  shows `CopyModeBanner` while it is true.
- **Leaving is `send-keys -X cancel`**, a copy-mode command, so no byte reaches the program. It
  runs **synchronously** (`tmuxCancelCopyMode`): keys typed right after the button are written
  straight behind it, and tmux eats them if the cancel has not landed. `ConnectionDeps.exitCopyMode`
  is typed `=> undefined` so an async implementation does not compile.
- Copy-mode entered from outside the app (a separate `tmux attach`) shows on the next input.

### A terminal xterm has killed can only be replaced (#846)

`Buffer.resize` in xterm 6.0.0 can finish with fewer lines than the viewport needs
(upstream [xtermjs/xterm.js#6063](https://github.com/xtermjs/xterm.js/issues/6063), **unfixed**);
the next write to a bottom row then throws in `lineFeed` / `_eraseInBufferLine`, which dereference
`lines.get(…)` with no null check. Three things about that failure decide how it is handled here —
all confirmed against `@xterm/headless@6.0.0` by reproducing the upstream flight-recorder state:

- **The throw is out of reach.** It happens inside the WriteBuffer's own `setTimeout`, not under
  our `term.write()` call, so no try/catch of ours can see it. The state has to be found by
  looking, not by catching — hence the probe in `terminalBufferHealth.ts`, run on `fit()`, on
  each output message, **and on a typed keystroke**. The third one exists because the first two
  can both stop happening: an idle cell is not being written to and is not being resized, so a
  terminal that died there stayed dead until a reload — while the person in front of it typed and
  read the frozen screen as "input is broken". The keystroke is the only signal such a cell gets,
  so it is the one that has to trigger the repair. Pointer reports are excluded (`isTypedInput`),
  like everywhere else input means "a person did this".
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

### The other silence: input the socket never took

A slot only writes to the socket when it is `OPEN` — during the reconnect backoff, or after a
`superseded` message, input is dropped and **nothing changes on screen**, which is indistinguishable
from a terminal that received it and printed nothing. The status pill says `disconnected`, but it
lives in a header the filmstrip hides and nobody watches a pill while typing.

So the manager tells the view (`ConnHandlers.onInputDropped`) and `Terminal.vue` shows the same
transient banner the drop/paste hints use. There is a `console.warn` on the same path, which is
what makes "I did something and nothing happened" diagnosable after the fact: it distinguishes a
socket that was down from a terminal that had stopped drawing (the #846 case above, which logs its
own line when it rebuilds).

Three details, each of which was wrong once:

- **Every path into the PTY reports, not just the keyboard.** `submitText` / `pasteText` /
  `pasteAndSubmit` used to answer a closed socket with `false` and nothing else, and only one
  caller ever read it — so a header button or a picked skill did nothing and explained nothing
  (#1315). `insertText` is the quietest of them: a dictated sentence, a dropped path, a pasted
  screenshot's path, all of which the user waits to see appear in the input box. A GUI press is
  the worse case in general: whoever made it never typed, so the natural reading is "this button
  is broken". Empty text is not a drop and stays silent.
- **The banner is on a cooldown, not once per stretch.** A stretch has no upper bound (the backoff
  retries forever at a 5s cap) while the banner lives six seconds, so "once per stretch" meant the
  person who came back and typed again got the silence back (#1316). The **log** line stays one per
  stretch — a post-mortem needs one, not fifty. Both reset in `sock.onopen`.
- **`willReconnect` decides the wording.** `connectionWillReturn` in `reconnectPolicy.ts`, not
  `shouldReconnect`: that one is blind to an armed retry (it answers "schedule another?"), so it
  would deny a reconnect mid-backoff and promise one after an exit.

### Renderer (canvas vs DOM)

The **canvas renderer** (`@xterm/addon-canvas`, added to fix CJK glyph drift — long Japanese lines
spilling off the right edge with the DOM renderer) draws each glyph in a fixed cell. The addon is
xterm-5-era on xterm-6 (see the version table), which looks alarming and **has not actually broken
anything**: it was once named the suspected cause of #782 and #783, and measurement disproved both
(#782 is tmux owning the scrollback and reproduces with the addon off; #783 was tmux stripping
hyperlinks, fixed in #785). WebGL was never evaluated against it — #314 needed a fixed grid, canvas
gave one, and `@xterm/addon-webgl` has never been a dependency.

**The mismatch still costs something, just not what was assumed.** There is no xterm-6 canvas
release, so the day an xterm bump breaks this addon, bumping it is not an option — the move is
forced rather than chosen. What to know before that day:

| | |
|---|---|
| Move to | `@xterm/addon-webgl`. **`0.19.0` is stable and xterm-6 era** — published 51 s after `@xterm/xterm@6.0.0`, the same pairing as 5.4.0/0.17.0 and 5.5.0/0.18.0. No beta needed; the `0.20.0-beta` line peers `@xterm/xterm@^6.1.0-beta`, i.e. the NEXT core. (#782's first comment says "要 beta" — that is wrong.) |
| Why not the DOM renderer | It drops the dependency, but re-opens the CJK drift #314 closed. That drift is **font-environment specific and does not reproduce headlessly**, so CI cannot protect it — it comes back as a user report. |
| Settle first | The WebGL **context limit** — browsers cap concurrent contexts and evict the oldest (order of ten; not measured here, so measure before relying on a number). This app is unusually exposed: a persisted slot **deliberately keeps its connection alive** when its view goes away (`Terminal.vue` calls `detach`, not `release` — that IS the persistence), so live terminals accumulate across tabs rather than tracking what is on screen. #965's reporter ran 22 cells. Needs `onContextLoss` handling and a decision about disposing off-screen terminals. |
| Also | WebGL is unavailable on GPU blocklists / GPU-less VMs / some remote desktops. Keep the same best-effort load + DOM fallback this site already has. |

**Disposal order (#2021).** The addon must be disposed BEFORE its terminal, and
`src/composables/terminalRenderer.ts` is the only place that does either. On dispose the addon
restores the DOM renderer through the core's `_createRenderer()`, which xterm 6 builds out of
`this.linkifier` — a `MutableDisposable` the terminal's own dispose has already cleared, so the DOM
renderer subscribes to `undefined` and throws
(`Cannot read properties of undefined (reading 'onShowLinkUnderline')`). Measured in a real browser
on the shipped pair: terminal-first throws 10/10, addon-first 0/10. It is not cosmetic — the throw
escapes `dispose()`, and in the #846 rebuild path it skipped the `connect()` that gives the
replacement terminal its socket, so the repair for a frozen cell left the cell dead.

**GPU context loss (#2076).** When Chrome restarts its GPU process it blanks every 2D canvas and
fires `contextlost` / `contextrestored` — and **nothing in the shipped stack listens**: grep both
bundles for either name and you get zero. The glyph cache is what does not survive. The addon keeps
glyph → atlas position in a `FourKeyMap` over 512px atlas pages, so after the restore the map still
says every glyph is rasterized while the pages are empty: the renderer blits nothing. Backgrounds
are `fillRect`s and keep drawing, which is the tell — **coloured bands with no text**, and only
characters typed after the restore appear, because a glyph the cache has not seen is rasterized
fresh. Before the fix the only recovery was a page reload.

`terminalRenderer.ts` now listens on `document` at the **capture** phase and calls
`clearTextureAtlas()` on every tracked terminal. Four facts hold it up, and each is a thing to
re-measure on an xterm bump:

| | |
|---|---|
| Why capture | `contextrestored` does not bubble, so an ancestor listener only sees it on the way down. |
| Whose canvas fires it | the terminal's **text layer**, which xterm puts in the document. Atlas pages are canvases the addon never attaches, so nothing of theirs reaches a document listener. If a future xterm stops putting the text layer in the DOM, this hook goes quiet with no error. |
| Why every terminal | terminals with the same font size and dpr SHARE an atlas (`acquireTextureAtlas` keys on them), but a different font size has its own — and a terminal parked off-screen fires nothing while still holding a stale cache. |
| Why the repaint is free | the core's `clearTextureAtlas()` calls `_fullRefresh()` itself, so no output or keystroke is needed to bring the text back. |

Measured by the reporter in headless Chrome 152, dark pixels in the text layer: 32784 before the
restart, **6393** after a plain `refresh()` (the new characters only), **41139** after
`clearTextureAtlas()`. On `@xterm/addon-webgl` the same problem is `onContextLoss`, which the table
above already names as something to settle before moving.

**Debugging note:** the canvas renderer
paints to `<canvas>`, so terminal text and link decorations are **not in the DOM** — headless
inspection (`.xterm-rows`, `elementFromPoint`) sees nothing. To debug links/selection headlessly,
force the DOM renderer or observe effects (`window.open`, buffer state) instead of reading the canvas.

### Live output, replay, and query stripping

- Live output is raw-forwarded. On **reattach**, the server replays a bounded tail
  (`entry.buffer`) through `stripTerminalQueries` (`terminal-replay.ts`) so xterm doesn't re-answer
  device queries (a DA reply would surface as `0;276;0c` in the prompt).
- The replay buffer tail is sliced carefully so a cut never lands inside an escape sequence (#434),
  and is sized (~1 MiB) so scrollback survives a reattach (#776).
- **A tail cannot carry a mode the app set once.** `CSI ? 1049 h` is written at pty offset 0 — when
  our tmux client attaches — and never again, so past 1 MiB it is certainly gone from the replay
  and the browser restores into the **normal** buffer. Measured on a real session: the tail had
  five `?1003h`/`?1006h` (apps re-set those) and **zero** `?1049h`. That alone switches the wheel
  and click synthesis off for good, since both are gated on the alternate buffer (#1073).
  So `reattachPty` asks tmux what the pane is in right now (`tmuxTerminalModes` — `alternate_on`
  and the `mouse_*_flag`s) and prefixes the DECSETs to the replay. tmux owns this state, which is
  why nothing here parses the pty stream for it.
  - **One sequence per mode.** The client only swallows a `CSI ? … h` whose parameters are ALL
    mouse modes; `CSI ? 1049 ; 1003 h` would reach xterm and put it into real mouse tracking,
    turning every drag into coordinate reports — the #729 regression.
  - Only tmux-backed sessions restore; a sandbox/tmux-less pty replays as before.
- **The replay is a stream of deltas, not a screen — so the screen is asked for.** The bounded tail
  reconstructs only the cells that changed inside its window: rows painted before it opened stay
  blank, and cells written at different moments sit side by side. A TUI makes this the normal case
  (Claude Code paints a transcript row once, then spends megabytes rewriting one status row). A pty
  **resize** used to hide it — tmux answers a size change with a full repaint, and the normal buffer
  reflowed — but a reattach at the size the pty already had leaves tmux silent, and the alternate
  buffer does not reflow. So `reattachPty` marks the entry and the first `resize` frame after it
  calls `tmuxRedrawClient` (`list-clients` → `refresh-client`), which repaints every row. Waiting
  for that frame is deliberate: it is where the client reports the size it settled at.
  - **Which client** is picked by `client_pid`, not by list order: a session can carry several
    (another server, a stray `tmux attach`) and tmux orders them arbitrarily. The pty we spawned IS
    the tmux client, so its pid identifies ours.

### A repaint is only worth as much as the window it repaints (#957)

**tmux learns a client's size from `SIGWINCH`, and the kernel raises `SIGWINCH` only when the size
actually CHANGES.** So re-sending the size the pty already holds is silent — and that is what every
path in the app does: the browser's `ResizeObserver` re-fits to the same size, a reload re-attaches
and sends it again from `sock.onopen`, and `tmuxRedrawClient` repaints faithfully at the size tmux
still believes in. Once the window and its client disagree, **nothing in the product closes the
gap**; only a real size change does, which is why resizing the browser window by hand was the
known workaround.

The screen this produces looks like a lost repaint but is not one: content in the top-left corner,
blank columns to the right and blank rows below, the agent's input box gone. The tell is that a
**reload does not fix it** — those cells were never written, because tmux's window really is that
small. Measured off a report: content wrapping at ~77 columns inside a ~136-column terminal.

Measured on tmux 3.6a against a live disagreement (client 120x40, window 80x24):

| attempted repair | window after |
|---|---|
| re-send the size the pty already has | 80x24 — unchanged |
| `refresh-client -t <our tty>` | 80x24 — unchanged |
| resize the pty to 120x39, then back | **120x40 — repaired** |

So `session/pty/tmux-size-sync.ts` probes `#{window_width}x#{window_height}` once a resize burst
settles and, on a disagreement, nudges the pty a row and back. **Do not reach for `resize-window`**
— it works, and it switches that window to `window-size manual`, after which the window stops
following its client for good.

Two mechanisms are known to open the gap, and the nudge repairs both: a second client on the
session (another server holding it, the overlap during a `yarn` restart — `window-size latest`
sizes the window to *that* client, which reproduces the symptom exactly while it is attached), and
a `SIGWINCH` that never lands. Which one the field reports came from is **not established**; the
repair logs both sizes (`[tmux-size]`) so the next occurrence is attributable, and a `still-wrong`
line means a third mechanism.

## The tmux passthrough rule

**This is the single most important gotcha.** tmux only forwards a program's advanced terminal
sequences to the outer terminal (our xterm) when told the outer terminal supports them. Two cases
have already bitten us, with the **same shape**:

| Feature | What breaks without it | Fix in `server/infra/process/tmux.ts` | Issue |
|---|---|---|---|
| OSC 52 clipboard | Claude's auto-copy never reaches the browser clipboard | `terminal-overrides` `Ms` capability | #206 |
| OSC 8 hyperlinks | Claude statusline `PR #NNNN` (and any OSC 8 link) isn't clickable | `set -as terminal-features '*:hyperlinks'` | #783 |

**If a future Claude Code / codex version starts emitting a new OSC/terminal feature (sixel,
notifications, kitty keyboard, OSC 7 cwd, …) and it "doesn't work through the app but works in a
bare terminal", suspect tmux stripping it first** — add the corresponding `terminal-features` flag
or `terminal-overrides` capability. The isolation test: write the sequence **directly to xterm**
(bypassing tmux); if it works there but not through a session, tmux is the culprit.

## Known issues / open items

- **#782 — scrollbar not shown / selection doesn't auto-scroll** (open). **Root cause is tmux, not
  the renderer** — every session runs inside tmux, tmux redraws the screen, so the outer xterm
  receives only the visible screen and the scrollback lives in tmux's copy-mode. Hence nothing for
  the scrollbar to show, and selection reaching only what is on screen. Measured: with tmux off the
  same xterm keeps 305 lines and the scrollbar tracks; with the canvas addon off, nothing changes.
  A fix is a design decision about handing the wheel to tmux copy-mode (see #782), which collides
  with the #729/#737 mouse swallow. **Do not reach for a renderer swap** — that hypothesis is dead,
  and this entry said otherwise until it was corrected.
- **Selection & copy/paste** — several sharp edges:
  - macOS: selection is **Option+drag** (`macOptionClickForcesSelection`), not plain drag.
  - You can only select what's on screen: an agent TUI runs in the **alternate buffer**,
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
| Renderer / CJK | canvas addon still **loads** (the console warns when it falls back to DOM). The peer-major mismatch is expected and is not the check — a silent fallback is, because the CJK grid goes with it | long Japanese line doesn't drift off the right edge |
| Scrollbar / selection | — (no unit coverage) | scrollbar visible + synced; Option+drag selects; selection auto-scrolls past the visible screen (#782) |
| OSC 8 links | tmux `terminal-features '*:hyperlinks'` present; xterm `linkHandler` set | click Claude statusline `PR #NNNN` → opens the PR (no confirm dialog) |
| OSC 52 clipboard | tmux `Ms` override + `set-clipboard on` present (`planMsOverride`) | Claude auto-copy reaches the browser clipboard |
| File-path links | `registerFilePathLinks` order vs WebLinks; `/api/files/raw` cwd containment | click a generated file path → previews the file |
| Enter / newline | `terminalSubmit` mapping + `isComposing` guard + `isImeConfirming` (Safari's compositionend-first ordering); `macOptionIsMeta` | Enter submits, Shift+Enter newlines; IME confirm not eaten on any browser; both `cr` and `esc-cr` |
| Mouse / wheel | `guardMouseTracking` swallow set (1000/1002/1003/1006); wheel→SGR in alt buffer; `wheelNotches` accumulation vs xterm's own `consumeWheelEvent` | wheel scrolls transcript (not prompt history); drag selects, doesn't emit mouse reports; a trackpad swipe moves a TUI about as far as it moves the scrollback |
| Copy-mode banner | `#{pane_in_mode}` still reports copy-mode on the installed tmux; `send-keys -X cancel` leaves it | wheel up in a shell cell shows the banner; hjkl there do not reach the shell; **Back to input** removes it and the next keys arrive (#2207) |
| Reattach | `stripTerminalQueries` patterns; replay buffer size; `tmuxTerminalModes` still reports `alternate_on` / `mouse_*_flag`, and `refresh-client` still forces a FULL repaint, on the installed tmux | reattaching a session doesn't leak `0;276;0c`-style junk; scrollback survives; after a reload the wheel still scrolls a Claude cell's transcript, and the screen matches `capture-pane` rather than showing spliced-together fragments (#1073) |

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
`src/composables/useTerminalConnections.ts`, `server/infra/process/tmux.ts`, `server/session/*.ts`.
Issues: #206, #263/#264/#293, #265/#266, #434, #445, #572, #729, #737, #772/#780, #776, #778, #782, #783/#785, #1073.
