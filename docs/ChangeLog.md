# Changelog

Release notes for MulmoTerminal, mirrored from the [GitHub Releases](https://github.com/receptron/mulmoterminal/releases). Newest first. Versions before `0.6.0` are on GitHub Releases only.

## mulmoterminal@0.6.1 — 2026-07-03

Patch release: the three grid features merged since `mulmoterminal@0.6.0`.

### Highlights
- **Agent state split** (#174): grid cells now distinguish **blocked** (waiting on a permission/question), **done** (finished a turn, output unreviewed), **working**, and **idle** — each with its own color (blocked = amber glow, done = blue glow, working = pulsing blue), and the auto-order is refined to `blocked > done > idle > working`.
- **Per-cell token usage badge** (#175): each cell's header shows its session's cumulative tokens (⇡ input incl. cache · ⇣ output), k/M-formatted with a breakdown tooltip, refreshed when a turn finishes.
- **Grid status summary** (#178): the toolbar shows an at-a-glance tally across all pages — how many cells are blocked (need input) / done (review) / working — so you can tell something needs you even when it's on an off-screen page.

### What's Changed
* docs: add docs/ChangeLog.md (mirror of the 0.6.0 release notes) by @isamu in https://github.com/receptron/mulmoterminal/pull/172
* feat: エージェント状態を blocked / done / working / idle に細分化 (#174) by @isamu in https://github.com/receptron/mulmoterminal/pull/176
* feat: セル別トークン使用量バッジ (#175) by @isamu in https://github.com/receptron/mulmoterminal/pull/177
* feat: グリッド状態サマリーをツールバーに表示 (#178) by @isamu in https://github.com/receptron/mulmoterminal/pull/179
* chore: bump version to 0.6.1 by @isamu in https://github.com/receptron/mulmoterminal/pull/180

**Full Changelog**: https://github.com/receptron/mulmoterminal/compare/mulmoterminal@0.6.0...mulmoterminal@0.6.1

## mulmoterminal@0.6.0 — 2026-07-02

This release lands 41 commits since `mulmoterminal@0.5.0`, focused on navigation, session/terminal persistence, the launcher, content browsing (collections + wiki), runtime translation, and a set of safety guards.

### Highlights

#### Navigation & terminal persistence
- **vue-router for top-level navigation** (#161): the app's top-level views are now driven by vue-router instead of ad-hoc local state, giving real routes for the single view, grid, collections, wiki, and accounting.
- **Terminals survive navigation** (#158): switching between views no longer tears down the PTY WebSocket — a terminal you leave keeps running and reattaches when you come back, instead of reconnecting from scratch.
- **Dynamic favicon** (#154): the browser tab favicon reflects live session state (a terminal `>_` mark that switches between working / needs-attention / idle), reconciled against the authoritative session list so it stays correct after prune/reconnect.

#### Launcher & working directories
- **Recent working directories in the launcher** (#155): an empty cell launcher remembers the directories you've started terminals in, so you can re-pick them quickly.
- **Auto-recorded directory presets** (#164, #163): launched directories are captured automatically as presets in most-recently-used order, and legacy `localStorage` recents are migrated forward. The manual "Directory presets" editor in Settings was removed in favor of this.

#### Collections, wiki & custom views
- **Collection registry import** (#157): a Discover tab wires the collection plugin host bindings — importing from a registry, listing feeds, and delete bindings for collection / feed / view.
- **Read-only Wiki browser** (#165): browse a wiki inside MulmoTerminal.
- **Custom-view write tier** (#167): `PUT /view-data` lets custom views persist data.
- Bump `@mulmoclaude/accounting-plugin` to 0.3.1 (#168).

#### Runtime translation
- **Translation service via a hidden chat** (#145, #150): `POST /api/translation` performs on-demand translation through a hidden Claude chat, and draft chat for collection starters was fixed alongside it.

#### Safety & UX guards
- **Confirm before closing the tab** (#149): closing or reloading the tab while a terminal is live pops the browser's native confirm dialog, so MulmoTerminal isn't closed by accident. It stays silent when nothing is running.
- **No false prompt on dev reloads** (#166): Vite HMR full-reloads are exempted from the close guard, so saving during development doesn't trigger the dialog.
- **Don't reap active chat sessions on switch-away** (#152): working/waiting sessions are kept alive when you switch away from them.
- **Hide grid sessions from the chat sidebar** (#169): multi-terminal grid sessions no longer clutter the single-view chat sidebar.

#### Server & housekeeping
- Move the GUI MCP endpoint under the `/api` prefix (#160).
- Archive completed plans into `plans/done/` (#151), docs updates (#159), and dependency refreshes (#147, #162, #170).

📦 **npm**: [`mulmoterminal@0.6.0`](https://www.npmjs.com/package/mulmoterminal/v/0.6.0)

### What's Changed
* feat: runtime translation service via hidden chat (POST /api/translation) by @snakajima in https://github.com/receptron/mulmoterminal/pull/145
* feat: activate translation + fix draft chat for collection starters by @snakajima in https://github.com/receptron/mulmoterminal/pull/150
* chore: archive 36 completed plans into plans/done/ by @snakajima in https://github.com/receptron/mulmoterminal/pull/151
* fix: don't reap working/waiting chat sessions on switch-away by @snakajima in https://github.com/receptron/mulmoterminal/pull/152
* feat: タブを閉じる/リロード前に確認ダイアログ（ターミナルがあるときのみ） by @isamu in https://github.com/receptron/mulmoterminal/pull/149
* update by @isamu in https://github.com/receptron/mulmoterminal/pull/147
* feat: 動的 favicon（ターミナル >_ マーク・状態で切替） by @isamu in https://github.com/receptron/mulmoterminal/pull/154
* feat: remember recent working directories in the cell launcher by @snakajima in https://github.com/receptron/mulmoterminal/pull/155
* feat: persist terminal connections across UI navigation by @snakajima in https://github.com/receptron/mulmoterminal/pull/158
* docs: update product-profiles plan for MulmoBooks decisions by @snakajima in https://github.com/receptron/mulmoterminal/pull/159
* refactor(server): move GUI MCP endpoint under /api prefix by @snakajima in https://github.com/receptron/mulmoterminal/pull/160
* feat: adopt vue-router for top-level navigation by @snakajima in https://github.com/receptron/mulmoterminal/pull/161
* update by @isamu in https://github.com/receptron/mulmoterminal/pull/162
* feat: wire collection plugin host bindings — registry import + feeds list + delete by @isamu in https://github.com/receptron/mulmoterminal/pull/157
* feat(wiki): read-only Wiki browser on MulmoTerminal by @snakajima in https://github.com/receptron/mulmoterminal/pull/165
* feat(unload-guard): skip the close confirm for Vite HMR reloads by @snakajima in https://github.com/receptron/mulmoterminal/pull/166
* Wire the custom-view write tier (PUT /view-data) by @snakajima in https://github.com/receptron/mulmoterminal/pull/167
* feat: 起動 dir を自動 preset 化し Settings の Directory presets を撤去 (#163) by @isamu in https://github.com/receptron/mulmoterminal/pull/164
* chore: upgrade @mulmoclaude/accounting-plugin to 0.3.1 by @snakajima in https://github.com/receptron/mulmoterminal/pull/168
* fix: hide multi-terminal grid sessions from the chat sidebar by @snakajima in https://github.com/receptron/mulmoterminal/pull/169
* update by @isamu in https://github.com/receptron/mulmoterminal/pull/170
* chore: bump version to 0.6.0 by @isamu in https://github.com/receptron/mulmoterminal/pull/171

**Full Changelog**: https://github.com/receptron/mulmoterminal/compare/mulmoterminal@0.5.0...mulmoterminal@0.6.0
