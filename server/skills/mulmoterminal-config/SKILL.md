---
name: mulmoterminal-config
description: Create or edit a .mulmoterminal.json to customize how a directory looks and behaves in MulmoTerminal — its name badge, chrome colors, xterm palette, attention sound, and header buttons/chips. Configures the current directory OR several of your recent MulmoTerminal directories at once. Use when the user wants to configure, theme, color-code, rename, or add header buttons/chips to a project's terminal — for one project or across many.
---

# Configure a MulmoTerminal directory

MulmoTerminal reads a per-directory file, `<project>/.mulmoterminal.json`, to style and
extend any terminal opened in that directory (grid cell + single view). This skill writes a
**valid** config from a short conversation with the user. Every field is optional.

A machine-readable JSON Schema for this file ships next to this skill as `schema.json` — read
it if you need the exact shape; the rules below are authoritative and match it.

## Workflow

### 1. Choose the target directory(ies)

- **This directory** (default): write `<cwd>/.mulmoterminal.json` — the directory this session
  is running in. Confirm the path if it's ambiguous.
- **Several directories at once** — when the user asks to configure/color-code *multiple*
  projects (e.g. "give each of my repos a distinct color"): read the user's recent MulmoTerminal
  directories from `~/.mulmoterminal/config.json`, the `cwdPresets` array (`[{ "label", "path" }]`)
  — the SAME list the New-terminal launcher offers. Show those directories and **ask which ones**
  to configure (all, a subset, or one). Then ask whether to apply the **same** styling to every
  chosen directory or to configure **each individually**. Only ever write to directories the user
  picked. If that file is missing or has no `cwdPresets`, there's no history yet — tell the user
  and ask them for the directory paths explicitly.

### 2. Ask what they want

A name badge, a color scheme, terminal palette, a completion sound, header buttons/chips. Offer
concrete suggestions (see the examples). Keep it short. When color-coding **many** directories,
give each a **visually distinct** hue so they're easy to tell apart in the grid — that's the point.

### 3. For each target directory

1. **Read the existing** `<dir>/.mulmoterminal.json` if present and treat this as an EDIT —
   preserve fields the user isn't changing. Never blow away their buttons/chips/colors when they
   only asked to tweak one thing.
2. **Write the JSON**, following the schema below exactly.
3. **Self-check**: every color is `#rrggbb`, `theme` is one of the four ids, palette values are
   valid, each button has the payload its `run` requires, and no unknown top-level keys are
   present. MulmoTerminal silently drops anything malformed, so an invalid field just won't take
   effect — get it right so the user sees their change.

Finish by confirming the list of files you wrote.

## Schema

All keys optional. Colors are lowercase `#rrggbb` unless noted.

### Identity & chrome colors

| Key | Meaning |
|---|---|
| `name` | Badge label (≤ 40 chars). |
| `badgeColor` | Name-badge color. |
| `headerColor` / `headerTextColor` | The cell header's background / text. |
| `cellColor` | Cell body background. |
| `cellBorderColor` | Cell border. |
| `dotColor` | Idle status dot. |
| `buttonColor` | Header icon buttons. |

> Working/attention state colors override these (they show while a session is busy or waiting);
> your colors show when the cell is idle.

### Terminal palette — `colors` and `theme`

`headerColor` etc. tint the **chrome** around the terminal. `colors` (and `theme`) paint the
**terminal contents** (xterm).

- `theme`: a preset palette — one of `"midnight"`, `"nord"`, `"daylight"`, `"solarized"`.
  (The id is `solarized`; "Solarized Light" is only its display label.)
- `colors`: per-key overrides on top of `theme`. Keys are xterm ITheme names; values accept
  `#rgb` / `#rgba` / `#rrggbb` / `#rrggbbaa`. Valid keys:
  `foreground`, `background`, `cursor`, `cursorAccent`, `selectionBackground`,
  `selectionForeground`, `selectionInactiveBackground`, and the ANSI 16:
  `black` `red` `green` `yellow` `blue` `magenta` `cyan` `white`
  `brightBlack` `brightRed` `brightGreen` `brightYellow` `brightBlue` `brightMagenta` `brightCyan` `brightWhite`.
  Unknown keys are dropped.

### Attention sound — `sound`

A **relative** path to an audio file **inside this directory** (e.g. `"./sounds/done.wav"`).
Absolute paths and `../` escapes are rejected. Omit for the built-in chime.

### Header buttons — `buttons`

An array (≤ 32) of action buttons added to a running session's header. Each:

```json
{ "id": "build", "emoji": "🔨", "label": "Build", "run": "shell", "cmd": "yarn build", "when": "isGitRepo", "order": 10 }
```

- `id` (required, unique), `label` (required), `run` (required): one of `"shell"` / `"input"` / `"open"`.
- `emoji` or `icon` (a material-symbol name) — optional.
- Payload by `run`:
  - `"shell"` → `cmd`: run this command in a command cell (server-resolved by id; never sent to the browser).
  - `"input"` → `text`: send this text to the running Claude/Codex (e.g. `"/compact"`).
  - `"open"` → `open`: one of
    - `url` — open in the browser (http/https only),
    - `reveal` — a directory path → the OS file manager (Finder/Explorer/xdg-open),
    - `files` — a directory path → the in-app file explorer,
    - `view` — an in-app overlay: `"diff"` / `"prs"` / `"wiki"` / `"collections"` / `"accounting"`.
- `when` (optional) visibility condition, `order` (optional) sort key (lower first, unset last).

### Header chips — `chips`

An array (≤ 16) of display chips, or **omit** the key entirely to keep the default set. Each item:

- a builtin id string: `"dir"` `"git"` `"ctx"` `"usage"` `"status"` `"diff"` `"tools"` (shown in the order listed; omit to hide), or
- a custom read-only chip: `{ "label": "env", "text": "⎇ ${branch}", "when": "isGitRepo" }`.

An empty array `[]` means "configured, show no builtins".

### `${var}` substitution (in `cmd` / `text` / `open` / custom chip `text`)

`${dir}` `${dirName}` `${branch}` `${repo}` `${model}` `${agent}` `${session}` `${remoteUrl}`
`${dirty}` `${ahead}` `${behind}` `${task}`.

### `when` mini-language (buttons & custom chips)

Atoms: `isGitRepo`, `!isGitRepo`, `key == value`, `key != value` (keys = the `${var}` names).
Combine with `&&` (binds tighter) and `||`. No parentheses. Empty/absent → always shown.
Example: `agent == claude && isGitRepo`.

## Examples

Minimal identity:

```json
{ "name": "acme-web", "badgeColor": "#2563eb", "headerColor": "#0b2545", "headerTextColor": "#e6f0ff" }
```

Bold color-coding, chrome + terminal body (Van Gogh style):

```json
{
  "name": "🌌 van-gogh",
  "badgeColor": "#f5b301",
  "headerColor": "#0b1a4a",
  "headerTextColor": "#f2e29b",
  "colors": { "background": "#0a1330", "foreground": "#f2e29b", "cursor": "#f5b301" }
}
```

Workflow buttons + a custom branch chip:

```json
{
  "buttons": [
    { "id": "compact", "emoji": "🗜️", "label": "Compact", "run": "input", "text": "/compact", "when": "agent == claude" },
    { "id": "gh", "emoji": "🌐", "label": "GitHub", "run": "open", "open": { "url": "https://github.com/${repo}" }, "when": "isGitRepo" },
    { "id": "build", "emoji": "🔨", "label": "Build", "run": "shell", "cmd": "yarn build" }
  ],
  "chips": ["git", "ctx", { "label": "env", "text": "⎇ ${branch}", "when": "isGitRepo" }]
}
```
