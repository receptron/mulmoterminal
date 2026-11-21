---
title: Customizing the header — a beginner's guide to buttons and chips
nav_title: Header buttons
layout: default
parent: English
nav_order: 10
description: How to put your own buttons on a MulmoTerminal terminal header, with screenshots and from the beginning — reading the header, your first button, icons and tooltips, and the four run types (input / shell / open / action). Variables, when and chips are in the header reference.
---

# Customizing the header
{: .no_toc }

- TOC
{:toc}

When the only way to run something is to type it into the terminal, you type it dozens of times a
day. MulmoTerminal lets you put **your own buttons** on the header of a running session: a few lines
of config, and sending `/compact`, running the tests, or opening the team wiki all become one click.

This page starts from **adding your very first button**. The full field reference lives in
[Configuration → customizing the header](config.html#header).

---

## 1. Read the header first {#anatomy}

Here is a cell with nothing configured. The header has two rows.

![The header of a cell with nothing configured](../images/header-default.png)

| Where | What's there | What config changes |
|---|---|---|
| Row 1, left | the status dot and **info chips** like `⎇ main` | [`chips`](header-reference.html#chips) reorders, hides and adds |
| Row 1, right | the **History** and **Tools** menus / set aside / expand / close — **cell actions** | not configurable (app structure) |
| Row 2, left | `~/acme-api ▾` — the **path menu** (below) | not configurable |
| Row 2, right | the **Skill** dropdown and a row of **icon buttons** | [`buttons`](#first-button) lands here |

**The right-hand side of row 2 is what you customize.** Your buttons land to the right of
**Skill** (the lightning-bolt icon); the icons there by default are fixed app controls.

> **There is only one default button** — **Open this branch's PR**, which appears only when the
> branch has an open PR. *Insert a file path*, *Reveal in the file manager*, *Browse files in the
> app*, *New terminal here* and the GitHub links used to be here and have moved into the path menu
> below.

### The path menu — anything to do with the directory {#path-menu}

The path on the left of row 2 (`~/acme-api ▾`) is a button. It opens the actions that apply to this
cell's directory.

![The path menu](../images/header-path-menu.png)

It holds **Insert a file path** (pick a file in the OS dialog; its absolute path is typed at the
prompt), *Reveal in the file manager*, *Browse files in the app* and *New terminal here*, in the UI
language. When the repository's remote is on GitHub, a **GitHub** section follows with
**Repository / Issues / Pull requests / Actions**; on GitLab (gitlab.com, or a host listed in
`gitlabHosts`) it is a **GitLab** section with **Repository / Issues / Merge requests /
Pipelines**. Those keep the forge's own names. This menu is fixed and config does not change it — if you want one of these as a
button too, write it yourself in [`buttons`](#run) and you get both.

---

## 2. Add your first button {#first-button}

**Without writing JSON:** Settings → **Header buttons and chips** adds a button to every terminal —
one that runs a command in a new cell, types text into the agent, opens something (a URL, a folder, a
view of the app, this branch's PR, a file picker) or runs one of the app's named operations — with an
optional icon and condition. The pencil on a row edits that button in place (its id and place stay),
and the others there remove or move it. The folder icon on a row puts that button in a folder — an
existing one or a new one named there; a folder's buttons are listed under it, and one taken out lands
right after the folder (the folder goes with its last button). Everything else is written as below.

### Which file to write in {#where}

| File | Applies to |
|---|---|
| `~/.mulmoterminal/config.json` | **every** terminal |
| `<project>/.mulmoterminal.json` | only cells opened **in that directory** |

**Buttons appear on AGENT cells** — every entry in the Agent Picker. A terminal started from
a launcher chip, a Shell cell or a Run command shows none of them: it is your own command line, and
nothing this app configures is added to it.

Starting per-project is the safer experiment. Create `.mulmoterminal.json` in the project root:

```json
{
  "buttons": [
    {
      "id": "compact",
      "icon": "compress",
      "label": "Compact this conversation",
      "run": "input",
      "text": "/compact"
    }
  ]
}
```

**No server restart is needed.** The header is re-read when the working directory, session or agent
changes, and **when the browser window regains focus** — so save in your editor, switch to the
browser, and it's there.

### What pressing it does {#what-happens}

`run: "input"` types `/compact` **into the Claude / Codex running in that cell and submits it** —
the same thing you'd do by switching to the terminal and typing, in one click.

### The trap — writing `buttons` replaces the defaults {#replace}

Writing `buttons` **anywhere replaces the whole built-in set** (it is not merged on top). Write only
the example above and **Open this branch's PR** disappears. List it yourself if you want to keep it:

```json
{
  "buttons": [
    { "id": "pr", "icon": "github:git-pull-request", "label": "Open this branch's PR", "run": "open", "when": "isGitRepo", "open": { "pr": true } },
    { "id": "compact", "icon": "compress", "label": "Compact this conversation", "run": "input", "text": "/compact" }
  ]
}
```

---

## 3. Icons and tooltips {#icon-label}

This is what trips people up first.

**`label` is not drawn on screen.** A button renders **only its icon**, and `label` becomes the
**tooltip you get on hover** (the browser's own).

So `label` is your only way to say what a button is. Prefer a phrase that names the action —
**`Run the tests`**, not `Build` — because nobody reads it until they hover.

| Key | Role |
|---|---|
| `icon` | a [Material Symbols](https://fonts.google.com/icons) name (`compress`, `science`, `menu_book`, …), or one of GitHub's own icons: `github:repo`, `github:issue-opened`, `github:git-pull-request`, `github:play`, `github:mark-github` (GitHub's logo). **The only thing drawn** |
| `emoji` | a single emoji; wins over `icon` |
| `label` | **required**. The hover tooltip, and the accessible name (`aria-label`) |

With neither `icon` nor `emoji`, you get `bolt` (a lightning bolt). A row of identical bolts tells
you nothing, so always set `icon`.

Below is a header with five buttons configured. Note that not one of them shows any text.

![A header with five configured buttons](../images/header-custom.png)

Side by side with an unconfigured cell — unconfigured on the left, the config above on the right:

![An unconfigured cell beside a configured one](../images/header-before-after.png)

---

## 4. The four `run` types {#run}

`run` decides what a button does. There are only four.

### `run: "input"` — send it to the agent {#run-input}

Types `text` into the session and submits it. For slash commands and prompts you repeat.

```json
{ "id": "compact", "icon": "compress", "label": "Compact this conversation", "run": "input", "text": "/compact" }
```

### `run: "shell"` — run a command {#run-shell}

Runs `cmd` in a **command cell**, leaving the agent's session undisturbed.

```json
{ "id": "test", "icon": "science", "label": "Run the tests", "run": "shell", "cmd": "yarn test" }
```

Pressing it opens a cell like this and shows the output:

![The command cell a run:"shell" button opens](../images/header-shell-cell.png)

> `cmd` **never reaches the browser**. On click the server looks it up again by `id`, shell-escapes
> the `${variables}`, and runs that.

### `run: "open"` — open something {#run-open}

**One key** inside `open` decides what opens.

**The table is also the precedence** if you write more than one — highest first.

| Key | Opens |
|---|---|
| `pr` | the current branch's PR in the browser (**the button hides itself when there is no PR**). The server resolves it into `url`, so **it beats an explicit `url` written alongside it** |
| `url` | a URL in the browser (`http` / `https` only) |
| `reveal` | the OS file manager (Finder / Explorer / `xdg-open`) |
| `files` | the in-app file explorer |
| `view` | an in-app view: `prs` / `wiki` / `collections` / `accounting`. (`diff` is accepted but **has no dedicated screen yet and opens the files view** — reach a worktree's diff from [the diff badge](worktree.html#diff-badge) instead) |
| `terminal` | a new terminal cell in that directory |
| `pickFile` | the OS file dialog, inserting the chosen path into the prompt |

```json
{ "id": "handbook", "icon": "menu_book", "label": "Open the team handbook", "run": "open", "open": { "url": "https://example.com/handbook" } }
```

> **Write only one per button.** Set several and **only the first** in that order takes effect; the
> rest are silently ignored.

### `run: "action"` — act on this cell {#run-action}

Acts on the cell itself — or, for the toolbar's operations at the end of the table, on the app. The
names are the [keyboard shortcut](config.html#keymap) names, so the same operation is a button, a
key, and a command-palette entry (the toolbar's are in the palette as its screen, Settings and
choice rows):

| `action` | What it does |
|---|---|
| `"terminal-new-here"` | Open the **launch panel** on this cell's directory — pick Claude, Codex, a shell, … (also the **＋** on row 2) |
| `"terminal-new-adjacent"` | Start a **shell** in this cell's directory at once |
| `"terminal-restart"` | Restart the agent in this cell (below) |
| `"terminal-close"` | Close this cell |
| `"zoom-toggle"` | Enlarge / collapse this cell |
| `"terminal-move-prev"` / `"terminal-move-next"` | Move this cell one place (manual order only) |
| `"mark-unread"` | Mark this cell unread / read |
| `"terminal-park"` | Set this cell aside / wake it |
| `"terminal-timeline"` | The **activity timeline** (Claude sessions only) |
| `"terminal-talk"` | **Talk to another terminal** |
| `"terminal-copy-code"` | **Copy the last code block** of the latest reply (the row-2 copy button) |
| `"terminal-insert-path"` / `"terminal-reveal"` | **Insert a file path** at the prompt / **open the directory** in the file manager (the path menu's items) |
| `"terminal-voice"` | **Voice input** on / off (the mic) |
| `"terminal-diff"` / `"terminal-note"` | Open the **changes panel** (worktree with changes) / write or edit the **note** |
| `"terminal-send-turn"` / `"terminal-send-since"` | **Send** this terminal's last exchange / every exchange since the last relay to its partner, and go there — [details](conversation.md#send) |
| `"terminal-bring-turn"` / `"terminal-bring-since"` | **Bring** the partner's last exchange / every exchange since the last relay here |
| `"pane-files"` | The **files pane** beside this cell |
| `"pane-prompts"` / `"pane-transcript"` | The **prompts you sent** / the **conversation** pane |
| `"pane-tools"` / `"pane-canvas"` / `"pane-collections"` | The **tools used** / **Canvas** / **Collections** pane |
| `"screen-wiki"`, `"screen-collections"`, … (every `screen-*`) | **Go to that screen** — the toolbar's doors |
| `"settings-open"` / `"sound-toggle"` / `"view-toggle"` | Open Settings / notification sound on-off / enlarged view roster-strip |
| `"confetti"` | Throw confetti over the app (the styles are ticked in Settings → Theme) |
| `"order-auto"` / `"order-manual"` / `"order-priority"` | Set the cell order |
| `"page-next"` / `"page-prev"` | Next / previous page of the grid |
| `"terminal-reopen"` | Reopen the terminal closed most recently |

A pane button toggles its pane on the cell the pane is on (the enlarged cell, or on the tiled grid the
tile that opened it). On any other cell it opens the pane there — beside the enlarged cell, or to the
right of the tiled grid without enlarging anything — as *Browse files in the app* does. When the cell cannot do it — `terminal-timeline` on a
non-Claude session, `terminal-talk` with no other terminal, a move outside manual order — the cell
says so instead of doing nothing. `"restart"`, the name before the shortcut names were shared, still
works.

```json
{ "id": "restart", "icon": "restart_alt", "label": "Restart the agent", "run": "action", "action": "terminal-restart" }
```

`"terminal-restart"` ends the agent process and starts it again **in the same cell, in the same directory, on
the same conversation** — no going back to the launcher to pick the directory and hunt for the
session in *or resume here*. This is what makes a changed MCP registration, an edited
`~/.mulmoterminal/config.json` or an updated plugin take effect: those are read once, when the
process starts.

> **It costs a resume, and it asks nothing first.** The conversation is read back from its
> transcript, which costs real tokens, and the agent is killed even mid-turn. Besides this button, the
> cell's Tools menu and the [`terminal-restart` shortcut](config.html#keymap) restart it.

### Group buttons into a folder {#folder}

Row 2 has only so much room. Put several occasional buttons in one **folder**: an entry with
`items` instead of `run`. It shows as one icon, and pressing it opens a menu listing each button
with its icon and label.

```json
{ "id": "ops", "icon": "construction", "label": "Operations",
  "items": [
    { "id": "restart", "icon": "restart_alt", "label": "Restart the agent", "run": "action", "action": "terminal-restart" },
    { "id": "test", "icon": "science", "label": "Run the tests", "run": "shell", "cmd": "yarn test" }
  ] }
```

- **One level only.** An entry inside `items` must be a button; a folder inside a folder is dropped.
- The folder's own `when` hides the whole folder; each button inside keeps its own `when`. A folder
  whose buttons are all hidden is not shown at all.
- Ids stay unique across folders and plain buttons — a button inside a folder that repeats an id
  already used is dropped.

### Commands for the command palette only {#commands}

Something you run now and then does not need an icon on every header. Write it under **`commands`**
instead of `buttons` — **exactly the same shape** (`run`, `when`, `${variables}`, folders) — and it
appears only in the **command palette** (the toolbar's Commands button, or your `command-palette` key).

```json
{ "commands": [
    { "id": "release", "label": "Cut a release", "run": "shell", "cmd": "yarn release" }
  ] }
```

- It works in both files, `~/.mulmoterminal/config.json` and the project's `.mulmoterminal.json`,
  merged by id like buttons.
- The palette lists the commands **and every header button** of the terminal it acts on: the
  enlarged one, or the one holding the cursor. `when` and `${variables}` resolve for that terminal,
  and a `shell` command runs there. With no terminal to act on, none are listed.
- A command cannot take an id a button already has; it is dropped.

---

## 5. From here on, look it up {#next}

You can build a button now. Everything past this point — the `${variables}`, every `when` form, how
the global and project files merge, chips, the Skill menu, and recipes to paste — lives in the
**[header reference](header-reference.html)**. That page is not meant to be read top to bottom; it
is meant to be **looked up while you write**.

| What you want | Where |
|---|---|
| what `${dir}` or `${task}` holds, and when it is empty | [`${variables}`](header-reference.html#vars) |
| the conditions (`!isGitRepo`, `!=`, "has a value") | [`when`](header-reference.html#when) |
| how the global and project files combine | [ordering and merging](header-reference.html#order-merge) |
| reordering and adding the row-1 info chips | [chips](header-reference.html#chips) |
| shortening the Skill menu | [the Skill menu](header-reference.html#skills) |
| a whole `.mulmoterminal.json` to paste | [recipes](header-reference.html#recipes) |

---

## See also {#related}

- [Header reference](header-reference.html) — variables, `when`, merging, chips, recipes
- [Configuration → customizing the header](config.html#header) — the full field reference
- [Configuration → per-project settings](config.html#per-dir) — colours, names, ordering: the other keys in the same file
- [Configuration](config.html) → "Frequent commands in the Run menu" — adding a **Run** menu with `script.json`
- The `/mulmoterminal-header` skill — if you'd rather have it written for you
