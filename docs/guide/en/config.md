---
title: Configuration
layout: default
parent: English
nav_order: 4
---

# Configuration
{: .no_toc }

- TOC
{:toc}

Settings live in three places: the **settings modal (⚙)**, the **global config `~/.mulmoterminal/config.json`**, and the **per-project `<project>/.mulmoterminal.json`**. Buttons and chips are merged from both files.

---

## Settings modal (⚙)

Open it from the ⚙ in the toolbar.

![Settings modal](../images/settings.png)

| Item | Description |
|---|---|
| **THEME** | Midnight / Nord / Daylight / Solarized Light |
| **NOTIFICATION SOUND** | The sound played when a cell needs attention (empty for the built-in chime, or any audio file) |
| **PULL REQUEST REPOS** | The repos aggregated by the cross-repo PR/Issue view (`owner/repo`) |
| **LAUNCH COMMANDS** | Commands you can launch besides Claude in a grid cell (`{ label, command }`) |
| **MCP SERVERS** | Your own MCP servers to add to single-view sessions |

## Global config `~/.mulmoterminal/config.json`

```json
{
  "cwdPresets": ["/Users/you/projects/acme-web", "/Users/you/projects/acme-api"],
  "launchers": [
    { "label": "Shell", "command": "$SHELL" },
    { "label": "Node REPL", "command": "node" }
  ],
  "prRepos": ["acme/web", "acme/api"],
  "userMcpServers": [],
  "buttons": [],
  "chips": null
}
```

| Key | Role |
|---|---|
| `cwdPresets` | Working-directory autocomplete in the launcher |
| `launchers` | The launch commands that appear under "OR LAUNCH" in a grid cell |
| `prRepos` | The repos targeted by the cross-repo PR/Issue view |
| `buttons` / `chips` | Header buttons / chips (merged with project settings → [Customizing the header](#header)) |

## Per-project `.mulmoterminal.json` {#per-dir}

Place this at the project root to change the appearance, sound, and header of **terminals (grid cells) opened in that directory**.

### Name badge and colors

```json
{
  "name": "acme-web",
  "badgeColor": "#2563eb",
  "headerColor": "#0b2545",
  "headerTextColor": "#e6f0ff",
  "cellColor": "#0e1117",
  "cellBorderColor": "#1f6f4f",
  "dotColor": "#22c55e",
  "buttonColor": "#a7f3d0"
}
```

All values are `#rrggbb`. The working / needs-attention status colors take priority over these background colors (which show when idle).

### Customizing the header (buttons / chips) {#header}

**Buttons** (`buttons`) — action buttons with emoji/labels that act on a running session. With none set, nothing is added, just as before.

```json
{
  "buttons": [
    { "id": "compact", "emoji": "🗜️", "label": "Compact", "run": "input", "text": "/compact", "when": "agent == claude" },
    { "id": "gh",      "emoji": "🌐", "label": "Open on GitHub", "run": "open", "open": { "url": "https://github.com/${repo}" }, "when": "isGitRepo" },
    { "id": "reveal",  "emoji": "📁", "label": "Reveal in Finder", "run": "open", "open": { "reveal": "${dir}" } },
    { "id": "build",   "emoji": "🔨", "label": "Build", "run": "shell", "cmd": "yarn build" }
  ]
}
```

- `run: "input"` … send `text` to the running Claude/Codex (e.g. `/compact`).
- `run: "open"` … `url` (browser, http/https only) / `reveal` (Finder) / `files` (in-app explorer) / `view` (`prs`/`wiki`/`collections`/`accounting`).
- `run: "shell"` … run `cmd` in a command cell (the id is resolved server-side, `${variables}` are shell-escaped, and the command never reaches the browser).
- `${variables}` … `dir` `branch` `repo` `ahead` `behind` `dirty` `agent` `model` `task`.
- `when` … `isGitRepo` / `agent == …` / `repo == …` (`&&` / `||`, with `&&` taking precedence).

**Chips** (`chips`) — reorder / hide the info chips in a grid cell header, plus custom ones. `null` (the default) behaves as before.

```json
{ "chips": ["ctx", "git", { "label": "env", "text": "⎇ ${branch}", "when": "isGitRepo" }] }
```

- Built-in `git` / `diff` / `ctx` / `usage` … shown in the order you list them; omit one to hide it.
- Custom `{ label, text, when }` … read-only text (`text` expands `${variables}`).

## Scripts `<project>/script.json`

Your project's scripts that can run in a grid cell (dev server, tests, build, and so on).

```json
{ "scripts": [ { "label": "dev", "command": "yarn dev" }, { "label": "test", "command": "yarn test", "cwd": "." } ] }
```

## Environment variables

| Variable | Default | Role |
|---|---|---|
| `CLAUDE_CWD` | `~/mulmoclaude` | The default working directory (the PTY's cwd) |
| `PORT` | `34567` | The server port |
| `MULMOTERMINAL_HOME` | `~/.mulmoterminal` | The root for managed git worktrees |

---

← [Back to the feature reference](features.html) / [Guide contents](index.html)
