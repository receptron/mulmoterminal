---
name: mulmoterminal-config
description: Create or edit a .mulmoterminal.json to customize how a directory looks and behaves in MulmoTerminal — its name badge, chrome colors, xterm palette, attention sound, and header buttons/chips. Walks a beginner through it: pick directories with checkboxes, start from a colour preset (warm / tropical / cool / bold), preview the real colours in the terminal, then refine. Configures the current directory OR several of your recent MulmoTerminal directories at once. Use when the user wants to configure, theme, color-code, rename, or add header buttons/chips to a project's terminal — for one project or across many.
---

# Configure a MulmoTerminal directory

MulmoTerminal reads a per-directory file, `<project>/.mulmoterminal.json`, to style and
extend any terminal opened in that directory (grid cell + single view). This skill writes a
**valid** config by walking the user through a few small choices. Every field is optional.

Two files ship next to this one:

- `palettes.json` — starting colour presets, grouped by vibe. **Always start from one of these.**
- `dir-config.schema.json` — the machine-readable JSON Schema. The rules in "Schema" below are
  authoritative and match it.

## How to run this conversation

**Ask one decision at a time, and always offer concrete options** — use `AskUserQuestion`, not open
prose questions. A beginner should never have to invent a hex code. Show, don't describe: preview
real colour in the terminal before asking them to commit to it.

### 1. Pick the target directories — with checkboxes

Ask which directories to configure:

- **This directory** (`<cwd>`) — the default.
- **Pick from my recent directories** — read `~/.mulmoterminal/config.json` and take `cwdPresets`
  (`[{ "label", "path" }]`, most-recent first — the same list the New-terminal launcher offers).
  Present them as **checkboxes**: `AskUserQuestion` takes up to 4 questions × 4 options, and each
  question supports `multiSelect: true`. Chunk the directories into groups of ≤ 4 and ask them as
  parallel multi-select questions (so up to 16 directories tick-able in one pass; run another round
  if there are more).
- **All recent directories.**

Only ever write to directories the user ticked. If `~/.mulmoterminal/config.json` is missing or has
no `cwdPresets`, say there's no history yet and ask for the paths.

### 2. Pick what to configure — checkboxes again

One `multiSelect` question: **Name badge + chrome colors** / **Terminal palette** / **Header buttons** /
**Header chips** / **Attention sound**. Configure only what they ticked.

### 3. Choose a colour direction — preset first, never a blank hex

Read `palettes.json`. Ask for the **vibe** first (four options, one question):

**☀️ Warm** · **❄️ Cool** · **🎨 Bold** · **⚪ Neutral**

Then **preview every preset in that vibe** (below) and ask which one they want. That's the big-picture
decision; the details come after.

### 4. Preview the colours in the terminal

Print the palette as **real colour**, so they can see it rather than imagine it. Convert each hex to
`r;g;b` and use 24-bit ANSI escapes. Render a mini fake terminal — badge, prompt, an error line, a
success line — because what matters is how *command output* will look against the background:

```bash
rgb() { printf '%d;%d;%d' 0x${1:1:2} 0x${1:3:2} 0x${1:5:2}; }
BG=$(rgb '#171210'); FG=$(rgb '#ece2dc'); AC=$(rgb '#d97757'); ER=$(rgb '#e06c5a'); OK=$(rgb '#a3b565')
printf '\033[48;2;%sm\033[38;2;%sm  ✳ my-project   ~/code/my-project   \033[0m\n' "$BG" "$AC"
printf '\033[48;2;%sm\033[38;2;%sm  $ yarn build                       \033[0m\n' "$BG" "$FG"
printf '\033[48;2;%sm\033[38;2;%sm  ✗ error: 2 problems                \033[0m\n' "$BG" "$ER"
printf '\033[48;2;%sm\033[38;2;%sm  ✓ done in 1.2s                     \033[0m\n' "$BG" "$OK"
```

Always print the hex codes beside the swatches too, so it still reads if the terminal can't do
truecolor. Re-run this preview after every change.

### 5. Refine, one axis at a time

After the preset, offer small, concrete choices — never "what colour do you want?". Preview after each:

- **Background** — darker / as-is / lighter
- **Accent** (cursor, badge, status dot) — keep / warmer / cooler
- **Header contrast** — subtle / strong

Stop as soon as they're happy. Two or three refinements is plenty unless they ask for more.

### 6. Propose only buttons that actually work here

Look at the directory before suggesting anything:

- `package.json` → offer only scripts that exist (`yarn build`, `yarn test`, …).
- `git rev-parse --is-inside-work-tree` → gate git buttons with `"when": "isGitRepo"`.
- `git remote get-url origin` → only offer a GitHub button if a remote exists; otherwise `${repo}`
  resolves to nothing and the button is dead.

Tell the user which buttons you skipped and why. Ones that work anywhere: `/compact`
(`run:"input"`, `when: "agent == claude"`), Files (in-app explorer), Reveal (OS file manager).

### 7. Chips

**Omit the `chips` key** unless they asked — that keeps their default chip set. An empty array `[]`
means "configured, hide every builtin", which is rarely what someone wants.

### 8. Write, then confirm

For each target directory: **read the existing `.mulmoterminal.json` first and merge** — never drop
fields the user didn't ask to change. Write the file, self-check it against the schema below, print
the preview once more, and list the files you wrote.

Configuring **several** directories? Give each a visually distinct hue from the same vibe, so they're
easy to tell apart at a glance in the grid — that's the whole point of colour-coding.

## Schema

All keys optional. Colors are lowercase `#rrggbb` unless noted. MulmoTerminal silently drops anything
malformed, so an invalid field just won't take effect — get it right so the user sees their change.

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
  - `"open"` → `open`: at least one of
    - `url` — open in the browser (http/https only),
    - `reveal` — a directory path → the OS file manager (Finder/Explorer/xdg-open),
    - `files` — a directory path → the in-app file explorer,
    - `view` — an in-app overlay: `"diff"` / `"prs"` / `"wiki"` / `"collections"` / `"accounting"`.
- `when` (optional) visibility condition, `order` (optional) sort key (lower first, unset last).

### Header chips — `chips`

An array (≤ 16) of display chips, or **omit** the key entirely to keep the default set. Each item:

- a builtin id string: `"dir"` `"git"` `"ctx"` `"usage"` `"status"` `"diff"` `"tools"` (shown in the order listed; omit to hide), or
- a custom read-only chip: `{ "label": "env", "text": "⎇ ${branch}", "when": "isGitRepo" }`.

### `${var}` substitution (in `cmd` / `text` / `open` / custom chip `text`)

`${dir}` `${dirName}` `${branch}` `${repo}` `${model}` `${agent}` `${session}` `${remoteUrl}`
`${dirty}` `${ahead}` `${behind}` `${task}`.

### `when` mini-language (buttons & custom chips)

Atoms: `isGitRepo`, `!isGitRepo`, `key == value`, `key != value` (keys = the `${var}` names).
Combine with `&&` (binds tighter) and `||`. No parentheses. Empty/absent → always shown.
Example: `agent == claude && isGitRepo`.

## Example result

A warm-clay project with buttons chosen to match what the directory supports:

```json
{
  "name": "✳ my-project",
  "badgeColor": "#d97757",
  "headerColor": "#2b1a12",
  "headerTextColor": "#f7e6dc",
  "theme": "midnight",
  "colors": { "background": "#171210", "foreground": "#ece2dc", "cursor": "#d97757" },
  "buttons": [
    { "id": "compact", "emoji": "🗜️", "label": "Compact", "run": "input", "text": "/compact", "when": "agent == claude" },
    { "id": "diff", "emoji": "📊", "label": "Diff", "run": "open", "open": { "view": "diff" }, "when": "isGitRepo" },
    { "id": "reveal", "emoji": "📁", "label": "Reveal", "run": "open", "open": { "reveal": "${dir}" } }
  ]
}
```
