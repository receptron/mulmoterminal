# Guide screenshots

Captured from a **throwaway demo instance** (a fresh `HOME`, empty config seeded with neutral demo data
— `acme-web` / `acme-api`, `Shell` / `Node REPL` launchers), so no personal session data appears. Retina
(`deviceScaleFactor: 2`), 1440×900 viewport.

**Except when a terminal is in frame.** xterm draws to a canvas it scales by the device pixel ratio
itself, so at `deviceScaleFactor: 2` the terminal text bakes in at double size while the rest of the
UI stays correct — the shot comes out with a giant terminal beside normal chrome. Capture those at
`deviceScaleFactor: 1` and accept 1× resolution. The two `worktree-close-*.png` are 1280×540 at 1×
for this reason.

**Or don't emulate the scale factor at all.** A headful browser with `defaultViewport: null`, sized to 1440×900 through CDP `Browser.setWindowBounds`, screenshots at the display's own retina ratio — xterm scales its canvas by the same ratio the rest of the page uses, so nothing bakes in at double size. Downscale the 2880×1800 result to 1440×900 afterwards. The three `v4.2.0-*.png` were captured this way.

**What a shot must never contain.** A resumed session's startup banner names the account's email, and the
roster and launcher print real directory names. Two images shipped for months with exactly that — one
showing an account email, one a screenful of real project paths — because nobody looked at the pixels
after capturing. Read every new shot before committing it.

## The app

Referenced from the README and the living guide, so these go stale when the UI moves.

| File | Shows |
|---|---|
| `hero.gif` | The grid, live: sessions changing colour by state in real time. The README's first image |
| `grid-2x2-live.png` | Four live Claude sessions side by side, each in its own colour-coded project |
| `grid-cell-live.png` | One live cell, for the cost & tokens section — the header's `Sonnet · ctx 8%` and `⇡1.3M ⇣5.9k` badges. Cropped out of a two-cell capture at bounds measured from the DOM, and **kept at retina rather than downscaled** — the whole point is reading two small badges. The token badge needs the `usage` chip AND turns the capturing server actually ran (a resumed fixture reads zero) |
| `cockpit-roster.png` | The cockpit roster — every session as one text row, beside the enlarged terminal |
| `zoom-canvas.png` | One agent zoomed, with the GUI panel (Canvas) beside it |
| `single-view.png` | The single view (chat + GUI panel). Removed in 4.0.0 — kept for the pages that describe 3.x |
| `grid-launch-form.png` | An empty grid cell's launcher form (dir / Claude·Codex / worktree / launch commands) |
| `grid-launch-form-shell.png` | The same form with Shell picked — only the working directory is left |
| `grid-one-cell.png` | One running cell — the two-row header, git chip, `connected` |
| `grid-two-cells.png` | Two parallel terminals |
| `grid-2x2.png` | Four parallel terminals (2×2) |
| `grid-zoom.png` | Expanded cell + filmstrip thumbnails |
| `files-pane.png` | The file pane open beside an enlarged terminal |
| `editor-syntax-highlight.png` | The Files view with a `.vue` file open — tree on the left, the editor colouring imports, types and strings |
| `settings.png` | The Settings modal (theme / sound / PR repos / launch commands / MCP) |
| `worktree-close-keep.png` | Closing a worktree cell with nothing unsaved — Keep worktree / Remove worktree / Cancel |
| `worktree-close-discard.png` | The same dialog when the worktree has unpushed commits + uncommitted changes — the button becomes `Discard & remove` |
| `push-lock-screen.jpg` | Push notifications on a phone's lock screen — finished tasks and "Claude is waiting for your input" |
| `remote-phone-terminal.jpg` | The terminal viewed from a phone — live screen plus yes / no / ok / continue / stop quick replies |

## Configuration

| File | Shows |
|---|---|
| `config-settings-modal.png` | The Settings modal: Theme, Terminal font size, Directory appearance, **Directory settings** (a directory expanded), Notification sounds |
| `config-dir-settings.png` | One expanded Directory-settings row — values in force with colour swatches, the file they came from, and `Not settings this app reads (a typo?)` listing a deliberately misspelt `badgeColour` and `fontSize2` |
| `config-launcher-chips.png` | An empty cell's launcher showing three settings at once: `cwdPresets` chips (with their directory-colour stripe), `script.json` under OR RUN A SCRIPT, `launchers` under OR LAUNCH |
| `config-custom-themes.png` | The Settings theme picker with four user-defined schemes (Mondrian / Van Gogh (Arles) / Picasso Blue / Matisse) beside the built-in four, with Van Gogh applied |
| `grid-colors.png` | Four projects color-coded via per-dir `.mulmoterminal.json` (Mondrian / Van Gogh / Picasso / Matisse). Real Claude cells in throwaway `/tmp` demo repos on untrusted dirs (so the trust prompt shows, no account/email leaks). |

## Dated release pages

One release's snapshot each. **Never re-shoot these to match new behaviour** — the page they belong to is
dated on purpose; write the next version's page instead.

| File | Shows |
|---|---|
| `toolbar-grid.png` | The grid's toolbar — Pull requests, Worklog, New terminal, ordering |
| `toolbar-chat.png` | The chat view's toolbar — Collections, Accounting, Wiki |
| `v240-chips.png` | Directory chips carrying each directory's configured colour |
| `v240-dir-settings.png` | The Directory settings section, with one directory expanded |
| `v240-path-to-pane.png` | A path clicked in the terminal, opened in the file pane beside it |
| `v2.5.0-rate-limit-gauge.png` | The grid header showing 5h and 7d rate-limit percentages for Claude and Codex |
| `v2.5.0-work-item-chip.png` | A cell header: the directory badge, the branch, then the work chip reading `#2621 → #2613` |
| `v2.5.2-theme-picker.png` | The Settings theme picker with five custom schemes beside the four built-ins |
| `v2.5.2-theme-van-gogh.png` | The app in the Van Gogh (Arles) theme — wheat-yellow ground, ochre borders, a sunflower-orange accent |
| `v2.5.2-theme-picasso-blue.png` | The app in the Picasso Blue theme — deep blue ground with a warm amber accent |
| `v2.7.0-session-memo.png` | Two cell headers side by side: one carrying a note with the pencil in the accent colour, one showing a session id with the pencil dim. Both headers the same height |
| `v2.7.0-zoom-splitter.png` | A zoomed cell with the roster on the left and the divider lit in the accent colour mid-drag |
| `v2.8.0-launcher-chips.png` | The launcher's directory chips, one running, the others idle with their colour on the leading stripe |
| `v2.8.0-settings-skills.png` | Settings: `Create a theme…` under the theme picker, `Configure appearance…` under Directory appearance, `Explain my settings…` under the directory list |
| `v2.9.0-roster-attention.png` | Three roster rows: amber ring = waiting for permission, green = finished-unread, blue = currently zoomed |
| `v2.9.0-sound-blocked.png` | The toolbar's right-hand icons, with the attention-sound bell highlighted to show the browser is blocking it |
| `v3.0.0-issue-rows.png` | Every issue row ending in a start button |
| `v3.0.0-choose-clone.png` | Choosing which clone the work happens in |
| `v4.2.0-pane-split.png` | The Canvas pane in SPLIT view beside an enlarged terminal — a wide table with its last four columns cut off at the pane's edge |
| `v4.2.0-pane-full.png` | The same table after the pane's expand button — full terminal row, every column visible, cockpit roster unmoved |
| `v4.2.0-done-green.png` | A 3×3 grid holding all three active states at once: five working (blue), two done (green), two waiting (amber) |
| `v4.3.0-gui-tools-workspace.png` | The launcher's GUI TOOLS section with the workspace selected — all of them, automatically, no per-directory registration |
| `v4.3.0-workspace-chip.png` | The launcher chip row: the workspace first with its own icon and no remove button, then two ordinary directory chips that have one |
| `v4.3.1-workspace-chip.png` | The same row after the workspace chip became capitalised `WORKSPACE` |

## Not yet captured (need a live Claude/Codex session)

These states need a real agent turn (cost/time) to look right, so they aren't referenced in the guide yet.
Capture from the demo instance while a Claude session runs, then add them:

- A worktree cell's diff PANEL (the badge itself is in `worktree-close-discard.png` as `+2 ●5`).
- The activity timeline (🕘) modal.
- The estimated-cost block in Settings.
