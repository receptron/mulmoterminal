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
| **NOTIFICATION SOUND** | The sound played when a cell needs you (empty for the built-in chime, or any audio file) |
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
| `providers` | Anthropic-compatible backends (→ [Running on another model](#providers)) |

## Running on another model (providers) {#providers}

Claude Code can talk to any Anthropic-compatible backend. MulmoTerminal reads those backends from
`config.json`, and their keys from the environment the **server** was started with — a key never
lives in a config file.

### 1. Add the backend to `~/.mulmoterminal/config.json`

```json
{
  "providers": [
    {
      "id": "openrouter",
      "label": "OpenRouter",
      "baseUrl": "https://openrouter.ai/api",
      "tokenEnv": "OPENROUTER_API_KEY",
      "maxOutputTokens": 16000,
      "models": []
    }
  ]
}
```

| Key | Role |
|---|---|
| `id` | The name `.mulmoterminal.json` and the launch picker refer to |
| `baseUrl` | **No trailing `/v1`** — Claude Code appends `/v1/messages` itself, so a trailing `/v1` produces `/v1/v1/messages` and 404s |
| `tokenEnv` | The **name** of the environment variable holding the key, never the key |
| `maxOutputTokens` | Defaults to 16000. Starved of output headroom, a thinking model spends its whole budget thinking and returns **empty** visible text |
| `models` | Extra model ids to offer alongside the built-in presets |

### 2. Put the key in the server's environment

In the shell that starts MulmoTerminal, or a `.env` beside it:

```bash
OPENROUTER_API_KEY=sk-or-…
```

Restart the server after adding one. A provider whose token cannot be resolved **refuses to
launch** — quietly falling back to Anthropic would send the session's prompts to a backend the
directory did not select.

### 3. A default for one project (optional)

```json
{
  "provider": "openrouter",
  "model": "moonshotai/kimi-k2.7-code"
}
```

Every session opened in that directory starts on it.

### Choosing at launch

When at least one provider is usable, the empty cell's launch form grows a **MODEL** select. The
choice applies to **that session only** — it does not rewrite `.mulmoterminal.json`. Leaving it
alone uses the directory's default.

The numbers beside each option are measured:

```
Kimi K2.7 Code · 3/3 · 14s · 262k
```

`3/3` is how many attempts of a real read-a-file-write-a-file task the model **completed**, out of
attempts made. Models that answer fluently but never call a tool are exactly why that number is
there. `14s` is the median run, `262k` the context window.

- `0/4 — never used a tool` — answers arrive, the tool loop never fires
- `not reachable from this account` — the OpenRouter account used for the measurement had every
  serving provider excluded by its [privacy settings](https://openrouter.ai/settings/privacy).
  **Not a defect in the model**; another account may run it fine
- `not tested` — a model you added yourself under `models`

The list lives in `common/modelPresets.ts`; re-measure with `scripts/model-trials.ts`:

```bash
yarn tsx scripts/model-trials.ts --provider openrouter --trials 3 <model-id>
```

### Limitation

Providers cannot be combined with the Docker sandbox (`MULMOTERMINAL_SANDBOX`). The container
inherits no environment, so such a session would silently run against **Anthropic instead of the
backend you picked** — it is refused outright rather than downgraded.

## Per-project `.mulmoterminal.json` {#per-dir}

Place this at the project root to change the appearance, sound, and header of **terminals (grid cells) opened in that directory**.

### Which model to use

```json
{
  "provider": "openrouter",
  "model": "moonshotai/kimi-k2.7-code"
}
```

The backend and model this directory's sessions start on. Omit `provider` and give only `model` to
pick a different model on Anthropic itself. → [Running on another model](#providers)

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

All values are `#rrggbb`. The working / needs-you status colors take priority over these background colors (which show when idle).

### The terminal itself (xterm palette)

Where `headerColor` and friends tint the **chrome** (header / cell frame), **`colors` (and `theme`) tint the terminal
itself (xterm)**. `colors` overrides xterm's ITheme — `background` / `foreground` / `cursor` and the 16 ANSI colors
(`red`, `green`, …).

```json
{
  "name": "🌌 van-gogh",
  "headerColor": "#0b1a4a",
  "headerTextColor": "#f2e29b",
  "colors": { "background": "#0a1330", "foreground": "#f2e29b", "cursor": "#f5b301" }
}
```

Set `theme` to `midnight` / `nord` / `daylight` / `solarized` for a preset palette; `colors` layers per-key
overrides on top. The color-coding screenshot in [Scenario 6](scenarios.html) combines header colors with `colors` to
paint each project — **from the header down to the terminal body**.

### Customizing the header (buttons / chips) {#header}

This is where MulmoTerminal's **Extend** pillar lives. Shape the header of a running terminal to fit your workflow with **a small DSL**.
Any developer can turn their frequent actions into a single click and surface only the information they want to see — that's what this is for.

**Buttons** (`buttons`) — action buttons with emoji/labels that act on a running session. With none set, nothing is added, just as before.

```json
{
  "buttons": [
    { "id": "compact", "emoji": "🗜️", "label": "Compact", "run": "input", "text": "/compact", "when": "agent == claude" },
    { "id": "gh",      "emoji": "🌐", "label": "Open on GitHub", "run": "open", "open": { "url": "https://github.com/${repo}" }, "when": "isGitRepo" },
    { "id": "reveal",  "emoji": "📁", "label": "Reveal folder", "run": "open", "open": { "reveal": "${dir}" } },
    { "id": "build",   "emoji": "🔨", "label": "Build", "run": "shell", "cmd": "yarn build" }
  ]
}
```

- `run: "input"` … send `text` to the running Claude/Codex (e.g. `/compact`).
- `run: "open"` … `url` (browser, http/https only) / `reveal` (OS file manager: Finder/Explorer/xdg-open) / `files` (in-app explorer) / `view` (`prs`/`wiki`/`collections`/`accounting`).
- `run: "shell"` … run `cmd` in a command cell (the id is resolved server-side, `${variables}` are shell-escaped, and the command never reaches the browser).
- `${variables}` … `dir` `branch` `repo` `ahead` `behind` `dirty` `agent` `model` `task`.
- `when` … `isGitRepo` / `agent == …` / `repo == …` (`&&` / `||`, with `&&` taking precedence).

**Chips** (`chips`) — reorder / hide the info chips in a grid cell header, plus custom ones. `null` (the default) behaves as before.

```json
{ "chips": ["ctx", "git", { "label": "env", "text": "⎇ ${branch}", "when": "isGitRepo" }] }
```

- Built-in `git` / `diff` / `ctx` / `usage` … shown in the order you list them; omit one to hide it.
- Custom `{ label, text, when }` … read-only text (`text` expands `${variables}`).

### ⚡ Skill menu filter (`skills`)

The header's **⚡ Skill ▾** lists the skills available in that directory
(`<project>/.claude/skills` and `~/.claude/skills`). Working-dir (project) skills come
first, then user-scope ones. Picking one runs the skill **in the current session**
(Claude: `/<slug>`; Codex: `Use the "<slug>" skill.`).

Set `skills` to an allowlist to show **only those slugs, in that order**. **Omit it to
show everything.**

```json
{ "skills": ["review-diff", "commit-msg"] }
```

- Skill names (slugs) must start alphanumeric and contain only `a-z 0-9 - _`; a slug that doesn't resolve is ignored.

## Scripts `<project>/script.json`

Your project's scripts that can run in a grid cell (dev server, tests, build, and so on).

```json
{ "scripts": [ { "label": "dev", "command": "yarn dev" }, { "label": "test", "command": "yarn test", "cwd": "." } ] }
```

## Environment variables

| Variable | Default | Role |
|---|---|---|
| `CLAUDE_CWD` / `--cwd` | The directory you run `npx mulmoterminal` in (only `~/mulmoclaude` when the server is started directly) | The default working directory (the PTY's cwd); also set via `--cwd` |
| `PORT` | `34567` | The server port |
| `MULMOTERMINAL_HOME` | `~/.mulmoterminal` | The root for managed git worktrees |

---

← [Back to the feature reference](features.html) / [Guide contents](index.html)
