---
name: mulmoterminal-header
description: Put your own action buttons and info chips in a MulmoTerminal session header — either everywhere (`buttons` / `chips` in `~/.mulmoterminal/config.json`; the global chips, global buttons of every `run` type, and folders can also be changed in Settings → Header buttons and chips) or for one project (`<project>/.mulmoterminal.json`, also editable in Settings → Directory settings). Buttons run a shell command in a new cell, type text into the running agent (`/compact`), or open a URL, the file explorer, a diff/PR/wiki overlay, or a new terminal. Chips show live context — branch, context left, diff counts, the PR or issue being worked on. `commands` are written exactly like buttons but appear only in the command palette. Use when the user wants to add, remove, reorder or hide header buttons or chips, wants a one-click build/test/deploy on a session, wants the header to show something it doesn't, or asks why a button is missing or does nothing. For colours and grid order use mulmoterminal-dirs; for keyboard shortcuts use mulmoterminal-keys.
---

# Header buttons and chips

A session header carries **buttons** (things you can do) and **chips** (things you can read). Both
are configured in two places and merged, and **the two merge by different rules** — that asymmetry
is the thing to get right, and it has no UI anywhere.

## Where to write it

| File | Applies to | Settings UI |
|---|---|---|
| `~/.mulmoterminal/config.json` → `buttons` | every directory | Settings → Header buttons and chips: add a `shell`, `input`, `open` or `action` button, edit one in place (id, `order` and `emoji` kept), remove or move any top-level entry, put a button in a folder (existing or new) or take it out, change a folder's name / icon / `when`, back to the built-in set. Reordering inside a folder is written here |
| `~/.mulmoterminal/config.json` → `chips` | every directory | Settings → Header buttons and chips (add, remove, reorder, back to the default set) |
| `<project>/.mulmoterminal.json` → `buttons` / `chips` / `commands` | that project | Settings → Directory settings → Change here → Header: the same editors as the global ones, on that project's lists (commands have no folders). An unset list there is empty, not the built-in set |

Ask which the user means. "A button for `yarn build`" is usually per-project (the command only
exists there); "show me the branch everywhere" is global.

Global writes are a **partial `POST /api/config` merge** — send only `buttons` / `chips`. Per-project
writes go through your Write/Edit tool, and **writing the file is itself the live-reload signal**;
there is no filesystem watcher.

**"Partial" is per TOP-LEVEL key, and `buttons` / `chips` are each replaced WHOLE.** The merge is
`body[key] !== undefined ? sanitize(body[key]) : current` (`server/config/app-config.ts`), so posting

```json
{ "buttons": [{ "id": "build", "icon": "build", "label": "Build", "run": "shell", "cmd": "yarn build" }] }
```

does not add a button — it **makes that the entire global set**, deleting every other button the
user had. Nothing warns, and the reply is a success.

So a global write always sends the **complete** array: read the current one first, add or change
your entry in memory, and post the whole thing. Every example below shows the entries under
discussion on their own for readability — none of them is a body to post as-is unless the user
genuinely has no others.

Three different "replace" rules live here and are easy to run together:

| | |
|---|---|
| writing `buttons` to the **global config** | replaces the whole global array — **the one this section is about** |
| listing `buttons` **at any level** | replaces `DEFAULT_BUTTONS`; the built-ins are not merged in |
| **project** vs **global** | merged, keyed by `id` — a project adds or overrides without restating |

## How the two are merged — not the same rule

**Buttons merge by `id`.** Global buttons load first, then the project's: a project button with the
same `id` **replaces** the global one, a new `id` is **added**. The result sorts by `order` (lower
first, unset last), ties keeping insertion order. So a project can override one button without
restating the rest.

**Chips replace wholesale.** A project that sets `chips` **discards** the global list entirely; one
that omits the key inherits it. There is no per-chip override.

**`null` (absent) and `[]` are different.**

- `buttons` absent at *both* levels → the built-in starter set below.
- `buttons: []` → **no buttons at all**, not "the defaults". And setting it globally means a project
  that configures nothing also gets nothing, since the empty list is what it inherits.
- `chips` absent → the client's default chip set. `chips: []` → every chip hidden.

**Omit the key you were not asked about.** Writing `chips: []` to a user who only wanted a button
silently strips their header.

## The built-in buttons

With `buttons` unset anywhere, these show. Each is an ordinary config button, so the way to trim or
reorder them is to **list the ones you want** — there is no "remove" syntax.

| id | Label | What it does |
|---|---|---|
| `pr` | Open this branch's PR | Git repos only; **hidden when the branch has no open PR** |

### The five that are no longer buttons

Insert a file path, Reveal in the file manager, the in-app file explorer, a new terminal here, and
Open on GitHub used to be default buttons. They are now items in the **path menu** — click the directory path on any
cell's header and they are all there. Open on GitHub became the menu's repository section, headed
**GitHub** (Repository / Issues / Pull requests / Actions) or **GitLab** (Repository / Issues /
Merge requests / Pipelines — gitlab.com or a host in `gitlabHosts`).

They moved because every one of them is a file operation on the directory this cell is in, which
is the question the path itself asks; `reveal` was the path's own click outright. A permanent icon
in a tiled cell for each occasional operation was the wrong trade. Any of them still works as a
button — `{ "id": "pick-file", "icon": "attach_file", "label": "Insert a file path", "run": "open",
"open": { "pickFile": true } }` brings the paperclip back.

Nothing about them changed as CONFIG. If a user wants any of them back as a button — one click
instead of two — list it and it works exactly as before:

```json
{ "id": "files", "icon": "folder_open", "label": "Browse files in the app", "run": "open", "open": { "files": "${dir}" } }
```

Say when you do that: they will then have it twice, once as their button and once in the path menu.
The menu is fixed and does not know what is on the toolbar.

**Say the other thing too, for this one button.** The label is the same and the destination is not:
the MENU item opens the file pane beside the enlarged cell (enlarging it first if the cell is
tiled), while this BUTTON opens the full-screen Files view. Both are correct — `open.files` takes
whatever path it is given, and the pane can only ever be rooted at the enlarged cell's directory, so
the button could not be the pane even if it wanted to be. A user who expected the pane and got the
full screen has hit exactly this, and there is nothing to fix in their config.

## Propose only buttons that work here

Look at the directory before suggesting anything, and say what you skipped and why:

- `package.json` → offer only scripts that exist (`yarn build`, `yarn test`, …).
- `git rev-parse --is-inside-work-tree` → gate git buttons with `"when": "isGitRepo"`.
- `git remote get-url origin` → without a remote, `${repo}` resolves to nothing and a GitHub button
  is dead. Don't offer it.

Ones that work anywhere: `/compact` (`run: "input"`, `when: "agent == claude"`), the file explorer,
the OS reveal.

## Buttons — schema

An array, ≤ 32 entries:

```json
{ "id": "build", "icon": "build", "label": "Build", "run": "shell", "cmd": "yarn build", "when": "isGitRepo", "order": 10 }
```

- `id` (**required**, unique — it is also the merge key), `label` (**required**),
  `run` (**required**): `"shell"` / `"input"` / `"open"` / `"action"`.
- `icon` — a [Material Symbols](https://fonts.google.com/icons) name (`build`, `folder`,
  `bar_chart`), or one of five GitHub icons: `github:repo`, `github:issue-opened`,
  `github:git-pull-request`, `github:play`, `github:mark-github` (the logo) (any other name, like a misspelt Material
  Symbol, is drawn as its own text). Prefer it. An `emoji` field exists and wins when both are set, but this project
  ships icons only.
- Payload, by `run`:
  - `"shell"` → `cmd` — runs in a command cell. Resolved **server-side by id** at exec time; the
    command is never sent to the browser.
  - `"input"` → `text` — typed into the running Claude/Codex, e.g. `"/compact"`.
  - `"open"` → `open`, with at least one of:
    `url` (http/https only) · `reveal` (dir → OS file manager) · `files` (dir → in-app explorer) ·
    `view` (`"diff"` / `"prs"` / `"wiki"` / `"collections"` / `"accounting"`) ·
    `terminal` (dir → a new cell running `$SHELL`) · `pr: true` (this branch's PR; the button hides
    when there is none) · `pickFile: true` (OS file dialog → insert the path).
  - `"action"` → `action` — acts on the cell itself, named like the `keymap` actions:
    `"terminal-new-here"` · `"terminal-restart"` · `"pane-files"` · … (the full list is under
    *`run: "action"`* below).
- `when` — visibility condition (below). `order` — sort key, lower first, unset last.

### A folder — several buttons behind one icon

An entry with `items` (and no `run`) is a folder: one row-2 icon that opens a menu listing each
button inside with its icon and label. Offer one when a user has several occasional buttons that
crowd the row.

```json
{ "id": "ops", "icon": "construction", "label": "Operations",
  "items": [
    { "id": "restart", "icon": "restart_alt", "label": "Restart the agent", "run": "action", "action": "terminal-restart" },
    { "id": "test", "icon": "science", "label": "Run the tests", "run": "shell", "cmd": "yarn test" }
  ] }
```

- `id`, `label`, `items` (**required**, 1–32 ordinary buttons); `icon` / `emoji` / `when` / `order` as
  for a button.
- **One level only** — a folder inside `items` is dropped on load. Do not write one.
- The folder's `when` hides the whole folder; each button inside keeps its own `when`. A folder
  whose buttons are all hidden is not drawn.
- Ids are unique across folders and top-level buttons: a button inside a folder that repeats an id
  already used is dropped. A shell button inside a folder still runs by its id.

## `run: "action"` — act on this cell

The names are the `keymap` action names (the `mulmoterminal-keys` skill), so one operation is a
button, a key and a command-palette entry under ONE name. Reach for these when someone misses a
button the header used to have:

| `action` | What it does |
|---|---|
| `"terminal-new-here"` | Launch panel on this cell's directory (also the `+` on row 2) |
| `"terminal-new-adjacent"` | A shell in this cell's directory, at once |
| `"terminal-restart"` | Restart the agent (below) |
| `"terminal-close"` / `"zoom-toggle"` | Close / enlarge-collapse this cell |
| `"terminal-move-prev"` / `"terminal-move-next"` | Move this cell (manual order only; declines otherwise) |
| `"mark-unread"` / `"terminal-park"` | Mark unread-read / set aside-wake |
| `"terminal-timeline"` / `"terminal-talk"` | Activity timeline (Claude only) / talk to another terminal |
| `"terminal-copy-code"` / `"terminal-insert-path"` / `"terminal-reveal"` / `"terminal-voice"` / `"terminal-diff"` / `"terminal-note"` | Copy the last code block / insert a file path / reveal the directory / mic on-off / changes panel / note |
| `"pane-files"` | The files PANE beside this cell (not the full-screen view `open.files` gives) |
| `"pane-prompts"` / `"pane-transcript"` / `"pane-tools"` / `"pane-canvas"` / `"pane-collections"` | The History / Tools menu panes |
| `"screen-*"` (e.g. `"screen-wiki"`), `"settings-open"`, `"sound-toggle"`, `"confetti"`, `"view-toggle"`, `"order-auto"` / `"-manual"` / `"-priority"`, `"page-next"` / `"page-prev"`, `"terminal-reopen"` | The toolbar's operations — act on the app, not this cell; a screen not set up (prs / rooms / worklog) shows a hint instead |

A pane action toggles the pane on the enlarged cell, and on a tile enlarges the cell and opens it.
A cell that cannot do it now shows a hint instead. Write the current names; `"restart"` (the name
before they were shared) is still accepted and read as `"terminal-restart"`.

### `"restart"`

```json
{ "buttons": [{ "id": "restart", "icon": "restart_alt", "label": "Restart the agent", "run": "action", "action": "terminal-restart" }] }
```

Ends the agent process and starts it again **in the same cell, on the same conversation** — no trip
back through the launcher. It is what makes a changed MCP registration, an edited
`~/.mulmoterminal/config.json` or an updated plugin take effect, because those are read once, when
the process starts.

Three things to say when you offer it:

- **It costs a resume.** The conversation is read back from its transcript, with the token cost that
  implies. This is not a free "reload".
- **No confirmation, even mid-turn.** It ends whatever the agent is doing. That is deliberate — the
  button only exists because someone wrote it — but it means the icon sits next to buttons that are
  harmless, and it is not.
- **Nothing else changes**: same directory, same agent, same model, same custom agent.

It is also an item in the cell's Tools menu, and the `terminal-restart` shortcut (the
`mulmoterminal-keys` skill, no default binding) does the same; this button is for one click.

## `commands` — entries for the command palette only

`commands` is a list written **exactly like `buttons`** (same `run` types, `when`, `${var}`,
folders) that the **command palette lists and the header never shows**. Use it for something run
now and then, which does not deserve an icon on every header.

- Both levels take it — `commands` in `~/.mulmoterminal/config.json` and in
  `<project>/.mulmoterminal.json` — merged by id like buttons (the project's entry wins).
- **No defaults**: absent means none.
- The palette lists the commands, and also every header button (folders unpacked), of the terminal
  it acts on — the enlarged one, or the one holding the cursor. `when` and `${var}` resolve against
  that terminal, and a shell command runs there. With no terminal to act on, none are listed.
- **Ids are shared with buttons**: a command whose id a button already has is dropped, because a
  shell entry is run by its id.

```json
{
  "commands": [
    { "id": "release", "label": "Cut a release", "run": "shell", "cmd": "yarn release" },
    { "id": "status", "label": "Ask for a status line", "run": "input", "text": "Summarise where this stands in one line." }
  ]
}
```

## Chips — schema

An array, ≤ 16 entries. Each is either a built-in id or a custom read-only chip.

Built-ins, shown in the order you list them (omit one to hide it):
`"dir"` `"git"` `"work"` `"ctx"` `"usage"` `"status"` `"diff"` `"tools"` `"env"` `"peer"`.

`work` is the one people miss: it names the PR or issue the cell is on. It is in the client's
default set, so a header nobody has configured shows it — but the moment you write `chips` at all,
**you must list it or it disappears**, and that reads as a feature breaking rather than a chip
being deselected.

`peer` is the name the other Claude Code sessions on this machine message this one by (what their
`ListAgents` lists, `myrepo-66`): an icon that copies it, drawn on Claude cells only.

Custom:

```json
{ "label": "env", "text": "⎇ ${branch}", "when": "isGitRepo" }
```

Custom chips are **display only** — no click behaviour. Something clickable is a button.

## `${var}` substitution

Available in `cmd`, `text`, `open.*`, and a custom chip's `text`:

`${dir}` `${dirName}` `${branch}` `${repo}` `${model}` `${agent}` `${session}` `${remoteUrl}`
`${dirty}` `${ahead}` `${behind}` `${task}`

## `when` — the visibility mini-language

Atoms: `isGitRepo`, `!isGitRepo`, `key == value`, `key != value` (keys are the `${var}` names,
written bare). Combine with `&&` (binds tighter) and `||`. **No parentheses.** Empty or absent →
always shown.

```text
agent == claude && isGitRepo
```

`key !=` with the right-hand side left empty tests "resolves to something" — `"when": "repo != "`
is what a GitHub button needs so it never renders as a bare `https://github.com/`. Use that rather
than `isGitRepo`: a git repo with no remote, or one whose remote is not GitHub, is still a git repo.

## After writing

- **Per-project**: live. The header re-resolves; nothing to reload.
- **Global**: a partial `POST /api/config` merge takes effect for sessions as they re-resolve their
  header; a hand-edit of the file while the server is running needs a restart.

Then check the real header. A button that doesn't appear is nearly always `when` (a non-git
directory, an agent mismatch) or a `pr` button on a branch with no PR — both are working as
designed, and both look like a broken config.

- **Every other button vanished** — a partial write. `buttons` is replaced whole; always send the
  array complete. Same for `chips`.

## Example — pinning the defaults, globally

The default set is short, so writing it out is the whole of it — this is the complete current
default configuration, useful as the starting point for adding to or trimming:

```json
{
  "buttons": [
    { "id": "pr", "icon": "github:git-pull-request", "label": "Open this branch's PR", "run": "open", "when": "isGitRepo", "open": { "pr": true } }
  ]
}
```

A project can then add its own build button without restating any of these — different `id`, so it
is merged in, not replacing them.
