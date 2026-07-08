# Feature: Configurable terminal header — action buttons + display chips

Status: **spec (for review)**. This document is the design; implementation follows once it's approved.

## User Prompt (consolidated)

> The two terminal headers show various data. I'd like to make that data manageable — via JSON,
> and via a simple DSL so a user can add things. For example a button = an emoji + a command to run
> + arguments (dir name, git branch, git repo, LLM model, codex-or-claude, …).
>
> By "header" I mean the **terminal's** header — dir name, the context amount, opening the dir, the
> tools-history part. This is about the **already-running** terminal, not session launch. So a button
> runs a command using the running session's context as variables (not spawning a new session).
>
> There is already a `.mulmoterminal.json` — merge the settings into that rather than a new file.
> For "open" actions, don't miss the OS/open features that already exist (reveal in Finder, in-app
> file explorer, in-app views), not just URLs.

## Goal

Let users **configure and extend the running terminal's header** through config files (JSON, canonical)
and a **1-line DSL** (sugar). Two parts:

- **(A) Action buttons** — emoji + an action (run in dir / send to session / open something), templated
  with the running session's context.
- **(B) Display chips** — read-only info in the header: toggle / reorder the built-ins, and define custom
  chips that show a value.

Session **launch** (agent/model/worktree at spawn time) is explicitly **out of scope** — this is about a
terminal that is already running.

### Hard requirement: default (no config) == today

With **no `buttons`/`chips` config anywhere**, the header must render and behave **exactly as it does
today** — same built-in chips in the same order, same built-in buttons (🎤/📎/📂), same ▶ Run menu. Config
is **purely additive/overriding**: `chips` absent ⇒ the client uses its current hardcoded default set;
`buttons` absent ⇒ only the current built-in buttons show; `script.json` still works until migrated. The
resolver signals "unconfigured" (`chips: null`, `buttons: []`) so the client falls back to today's UI.

## Current state (grounding)

**Terminal header (`Terminal.vue .header`, all views):** `Terminal` label · dir badge (name/color) ·
`GitBranchChip` (branch/dirty) · connection status · `RunMenu` (▶, from `script.json`) · 🎤 voice · 📎
insert-file-path · 📂 `folder_open` (in-app file explorer).

**Grid cell header (`TerminalCell .cell-header`, overlaid in grid):** status dot · dir badge · worktree
diff (`+ahead ●dirty`) · **`ModelContextBadge` (model · ctx%)** · usage (`$`/tokens) · Run · Files ·
zoom · close.

**Tools history:** `ToolsPane.vue` (right pane, toggled) — Tool Call History (every tool call) + Available
Tools.

All of the above is **hardcoded** — no user toggle / reorder / add.

**Existing config files (reused, not replaced):**

| Scope | File | Loader | Holds today |
|---|---|---|---|
| Project (per-dir) | `<cwd>/.mulmoterminal.json` | `server/dir-config.ts` (`DirConfig`) | `name`, `badgeColor`, `theme`, `colors`, `sound` |
| Global | `~/.mulmoterminal/config.json` | `server/app-config.ts` (`AppConfig`) | `cwdPresets`, `soundFile`, `prRepos`, `launchers`, `userMcpServers` |
| Project (per-dir) | `<cwd>/script.json` | `server/scripts.ts` | `scripts: [{label, command, cwd?}]` → Run menu |

**Existing "open" capabilities (reused by `run:open`, see below):** reveal a dir in Finder/OS
(`server/open-dir.ts`), in-app file explorer (`filesGotoIndex` → `FilesOverlay`), URL in browser
(`pluginRuntime.openUrl`, http/https allowlist), in-app views (diff / PRs / wiki / collections /
accounting).

**Existing launch-arg builders (referenced by the run:input security note):** `server/claude-args.ts`,
`server/codex-args.ts`.

---

## Design

### (A) Action buttons

```jsonc
// run: "shell" — run a command in this terminal's dir, as a separate process (like today's Run menu)
{ "id": "pr", "emoji": "🔀", "label": "PR",
  "run": "shell", "cmd": "gh pr create --head ${branch}", "when": "isGitRepo" }

// run: "input" — type/send text into the RUNNING claude/codex session (like the draft/paste path)
{ "id": "compact", "emoji": "🗜", "label": "Compact",
  "run": "input", "text": "/compact", "when": "agent == claude" }

// run: "open" — open something (targets below); NOT just URLs
{ "id": "gh",     "emoji": "🌐", "label": "GitHub", "run": "open", "open": { "url": "https://github.com/${repo}" }, "when": "isGitRepo" }
{ "id": "reveal", "emoji": "📁", "label": "Finder", "run": "open", "open": { "reveal": "${dir}" } }
{ "id": "files",  "emoji": "🗂",  "label": "Files",  "run": "open", "open": { "files":  "${dir}" } }
{ "id": "diff",   "emoji": "±",  "label": "Diff",   "run": "open", "open": { "view":   "diff" }, "when": "isGitRepo" }
```

**Fields:** `id` (stable merge key) · `emoji` (or `icon` for a material-symbol) · `label` (tooltip / visible
text) · `run` (`shell` | `input` | `open`) · payload by run type (`cmd` / `text` / `open`) · `when`
(visibility) · optional `order`.

**`run: "open"` targets** (all reuse existing code — no new OS integration for v1):

| target | opens | reuses |
|---|---|---|
| `{ "url": "…" }` | URL in the browser (http/https only) | `pluginRuntime.openUrl` |
| `{ "reveal": "path" }` | the dir in Finder / OS file manager | `server/open-dir.ts` |
| `{ "files": "path" }` | the in-app file explorer / editor | `filesGotoIndex` / `FilesOverlay` |
| `{ "view": "diff\|prs\|wiki\|collections\|accounting" }` | an in-app view | existing overlays / routes |

(External-editor launch, e.g. `vscode://`, is **v2** — the current URL allowlist is http/https only.)

**`when` (visibility, v1):** `isGitRepo` · `agent == claude|codex` · `repo == owner/name`, combinable with
`&&` / `||`. Evaluated per session from its live context; a button whose `when` is false is not shown.

### (B) Display chips

```jsonc
"chips": [
  "dir", "git", "ctx",                                        // built-in ids, in this order (usage/status dropped)
  { "label": "↑↓",   "text": "↑${ahead} ↓${behind}", "when": "isGitRepo" },   // custom, display-only
  { "label": "repo", "text": "${repo}" }
]
```

- **Built-in chip ids:** `dir` · `git` · `ctx` · `usage` · `status` · `diff` · `tools`.
- **Toggle + reorder:** the array picks which built-ins show and in what order.
- **Custom chips:** `{ label, text, when? }` render a substituted string. Display-only (not clickable) —
  this is the difference from a button.

### Variables (v1)

Substituted from the **running session's context** (server-resolved — the values are trusted app state,
not user input, so v1 has no injection surface from `${input}`):

`${dir}` · `${dirName}` · `${branch}` · `${repo}` · `${model}` · `${agent}` · `${session}` ·
`${remoteUrl}` · `${dirty}` · `${ahead}` · `${behind}` · `${task}`

### Simple DSL (1-line sugar → expands to the JSON above)

```
# button:  <emoji> <label> = [prefix]<spec>   [when <cond>]
#   prefix: (none)=shell   > =input   @ =open
🔀 PR      = gh pr create --head ${branch}     when isGitRepo
🗜 Compact = > /compact                         when agent==claude
🌐 GitHub  = @ https://github.com/${repo}       when isGitRepo
📁 Finder  = @ reveal:${dir}
🧹 Lint    = yarn lint

# chips:
chips: dir git ctx
chip ↑↓ = ↑${ahead} ↓${behind}   when isGitRepo
```

The DSL is stored/edited as text and parsed to the JSON model; the settings UI can round-trip either form.

### Storage & merge (extend existing files — no new files)

- **Project:** add `buttons` / `chips` to `<cwd>/.mulmoterminal.json` (`DirConfig`) — sits next to the
  existing per-dir `name`/`badgeColor`/`theme`/`sound`, and is commit-shareable.
- **Global:** add `buttons` / `chips` to `~/.mulmoterminal/config.json` (`AppConfig`) — alongside
  `launchers`/`presets`/…, applies to all terminals (use `when` to scope).
- **Merge:** buttons merge by `id` (project overrides/adds over global); if a scope defines `chips`, it
  replaces the other's chip list (last-wins: project over global).

### `script.json` absorption

`<cwd>/script.json` is per-dir shell commands — the same shape as a `run:"shell"` button. Consolidate:

- Migrate `{label, command, cwd?}` → `{emoji?, label, run:"shell", cmd, dir?}` under
  `.mulmoterminal.json.buttons`, so **per-dir config is one file**.
- Transition: keep reading `script.json` and auto-bridge its entries to `run:"shell"` buttons; the ▶ Run
  menu is replaced by those buttons and `script.json` is deprecated (removed after migration).

### Security

- `run:"shell"` / `run:"input"` go through the existing sanitize path (`sanitizeScripts`, the flag-smuggle
  guards in `server/index.ts`). `run:"input"` injects into the PTY via the existing draft/paste mechanism.
- `run:"open"` `url` keeps the http/https scheme allowlist; `reveal`/`files` resolve paths **inside the
  session's cwd** (same confinement as `dir-config`/`FilesOverlay`).
- Variables are server-resolved from trusted session state; v1 has no `${input}`, so no user-supplied
  substitution.

### v1 / v2

- **v1:** buttons (`shell`/`input`/`open` with url/reveal/files/view targets) · extended variables ·
  `when` · chips (toggle/reorder/custom) · global + project merge · `script.json` absorption.
- **v2:** `${input:label}` interactive prompt on click · richer `when` operators · dynamic chips (chip
  whose text is a command's output) · external-editor `open` (`vscode://` allowlist).

---

## Implementation sketch (affected areas)

**Server**
- `dir-config.ts`, `app-config.ts`: extend schemas with `buttons`/`chips` + sanitizers (validate `run`,
  targets, `when`, cap counts, reject unknown fields).
- New `header-config.ts`: merge global+project, parse/emit the DSL, and **resolve** a session's buttons/chips
  (evaluate `when`, substitute variables) from its live context (cwd, git status, model, agent, session id).
- `script.json` bridge in the resolver.
- Endpoints: extend `config-routes.ts` (global) + the dir-config API; a per-session "resolved header" endpoint
  or field so the client just renders + dispatches.
- Reuse: `open-dir.ts` (reveal), `/ws/run`-style exec (shell), PTY input (input), git status source (`when`).

**Client**
- Render `buttons`/`chips` in `Terminal.vue` `.header` (and `TerminalCell .cell-header`), keeping the built-in
  icons; dispatch on click: shell → run-in-dir, input → session input, open → `openUrl`/`filesGotoIndex`/route/
  reveal.
- Settings UI to edit buttons/chips (emoji picker, run-type dropdown, when field) with raw JSON + DSL editing.

## Open questions (for review feedback)

1. DSL grammar details (prefix set, `when` syntax) — OK as sketched, or prefer explicit keys?
2. Chip merge: replace vs. append when both scopes define `chips`?
3. Built-in chip id names (`dir`/`git`/`ctx`/`usage`/`status`/`diff`/`tools`) — good, or rename?
4. Where the "resolved header" is computed — per-session server endpoint vs. client-side from data it already has?
5. `script.json` removal timeline — auto-migrate on first read, or leave both until a manual migration?
