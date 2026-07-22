---
name: mulmoterminal-config
description: Create or edit a .mulmoterminal.json to customize how a directory looks and behaves in MulmoTerminal — its name badge, chrome colors, xterm palette, attention sound, header buttons/chips, and which model/provider its sessions run on. Also sets up an Anthropic-compatible backend (OpenRouter, Moonshot, a gateway) in the global config. Walks a beginner through it: pick directories with checkboxes, start from a colour preset (warm / tropical / cool / bold), apply it and look at the real cell, then refine. Configures the current directory OR several of your recent MulmoTerminal directories at once. Use when the user wants to configure, theme, color-code, rename, or add header buttons/chips to a project's terminal — for one project or across many.
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
prose questions. A beginner should never have to invent a hex code. Show, don't describe: apply a
preset and let them look at the real cell, which recolours the moment you write the file.

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
**Header chips** / **Attention sound** / **Which model it runs on**. Configure only what they ticked.

### 3. Choose a colour direction — preset first, never a blank hex

Read `palettes.json`. Ask for the **vibe** first (four options, one question):

**☀️ Warm** · **❄️ Cool** · **🎨 Bold** · **⚪ Neutral**

Describe each preset in that vibe (below), ask which one they want, then apply it. That's the
big-picture decision; the details come after.

### 4. How to show colours — the terminal is the only real preview

**Do not try to paint swatches with ANSI escape codes.** Claude Code does not render colour in tool
output, and a Bash child here has no controlling terminal (`/dev/tty` → `device not configured`), so
the user sees nothing. Verified — don't waste a turn on it.

What to do instead:

1. **Name the colours.** For each candidate give its hex values and one line on how it feels
   ("terracotta on near-black — cosy, low glare"). Optionally add a rough emoji swatch (🟫 🟦 🟩 ⬛)
   so there's something to look at.
2. **Apply, then look at the real thing.** Write the config — the cells for that directory recolour
   **immediately**, no page reload and no server restart. (Writing the file with your Write/Edit tool
   is what tells MulmoTerminal to re-read it, so always write it rather than asking the user to.)
3. Ask what to change, adjust, look again. Two or three rounds is plenty.

The cell they're looking at IS the preview, and it's exact — better than any approximation.

### 5. Refine, one axis at a time

After the preset, offer small, concrete choices — never "what colour do you want?". Apply and look
after each — the change lands live:

- **Background** — darker / as-is / lighter
- **Accent** (cursor, badge, status dot) — keep / warmer / cooler
- **Header contrast** — subtle / strong

Stop as soon as they're happy.

Note: the chrome colours only show while the cell is **idle** — the working/attention colours take
over while a session is busy or waiting on the user.

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
fields the user didn't ask to change. Write the file, self-check it against the schema below, and list
the files you wrote. The cells recolour as soon as you write — nothing to reload.

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

### Model — `provider` and `model`

| Key | Meaning |
|---|---|
| `provider` | `id` of a backend in `~/.mulmoterminal/config.json` under `providers`. Omit to stay on Anthropic. |
| `model` | Passed to `claude --model`. With no `provider`, this picks a different Anthropic model. |

Both are defaults for the directory — the launch form can override them for a single session.

**Never invent a model id.** Read `common/modelPresets.ts` in the MulmoTerminal repo and offer what
is listed there, with its measured pass rate. Each entry records how many attempts of a real
tool-using task the model completed: a model can answer fluently and still never call a tool, so
`3/3` and `0/4` are the difference between a usable session and a broken one. Prefer entries whose
`trials` are `measured` with `passed === of`. If the user names a model that is not listed, add it
to that provider's `models` array in the global config rather than silently trusting it, and say it
is untested.

A directory naming a `provider` that is missing its key does not fall back — its sessions refuse to
start. Check the provider exists in the global config before writing `provider` here.

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

An array (≤ 32) of action buttons for a running session's header. Each:

```json
{ "id": "build", "emoji": "🔨", "label": "Build", "run": "shell", "cmd": "yarn build", "when": "isGitRepo", "order": 10 }
```

**Omit `buttons` entirely** to keep the built-in defaults (a file-path picker + an OS file-manager
reveal). Setting `buttons` — even to `[]` — **REPLACES** the defaults (it isn't merged on top), so the
array you write is the whole button row; re-add the file picker with `{ "run": "open", "open": { "pickFile": true } }`
or the in-app file explorer with `{ "run": "open", "open": { "files": "${dir}" } }` if you want them.

- `id` (required, unique), `label` (required), `run` (required): one of `"shell"` / `"input"` / `"open"`.
- `emoji` or `icon` (a material-symbol name) — optional.
- Payload by `run`:
  - `"shell"` → `cmd`: run this command in a command cell (server-resolved by id; never sent to the browser).
  - `"input"` → `text`: send this text to the running Claude/Codex (e.g. `"/compact"`).
  - `"open"` → `open`: at least one of
    - `url` — open in the browser (http/https only),
    - `reveal` — a directory path → the OS file manager (Finder/Explorer/xdg-open),
    - `files` — a directory path → the in-app file explorer,
    - `view` — an in-app overlay: `"diff"` / `"prs"` / `"wiki"` / `"collections"` / `"accounting"`,
    - `terminal` — a directory → open a NEW grid cell running the OS default shell (`$SHELL`) there, next to the current cell,
    - `pr: true` — open the current branch's PR in the browser (the button is hidden when there's no open PR),
    - `pickFile: true` — open the OS file dialog and insert the chosen path(s) into the session.
- `when` (optional) visibility condition, `order` (optional) sort key (lower first, unset last).

### Header chips — `chips`

An array (≤ 16) of display chips, or **omit** the key entirely to keep the default set. Each item:

- a builtin id string: `"dir"` `"git"` `"ctx"` `"usage"` `"status"` `"diff"` `"tools"` (shown in the order listed; omit to hide), or
- a custom read-only chip: `{ "label": "env", "text": "⎇ ${branch}", "when": "isGitRepo" }`.

### Skill menu — `skills`

The header's **⚡ Skill ▾** dropdown lists this directory's Claude skills (`.claude/skills`,
user + project scope) and runs the picked one in the session. `skills` is an **allowlist
that also sets the order**: an array (≤ 100) of skill slugs — only these appear, in this
order. **Omit `skills`** to show every discovered skill (working-dir skills first). Slugs
that don't resolve to a real skill are simply ignored.

```json
{ "skills": ["review-diff", "commit-msg"] }
```

### `${var}` substitution (in `cmd` / `text` / `open` / custom chip `text`)

`${dir}` `${dirName}` `${branch}` `${repo}` `${model}` `${agent}` `${session}` `${remoteUrl}`
`${dirty}` `${ahead}` `${behind}` `${task}`.

### `when` mini-language (buttons & custom chips)

Atoms: `isGitRepo`, `!isGitRepo`, `key == value`, `key != value` (keys = the `${var}` names).
Combine with `&&` (binds tighter) and `||`. No parentheses. Empty/absent → always shown.
Example: `agent == claude && isGitRepo`.

## Setting up a backend — `~/.mulmoterminal/config.json`

Only when the user wants a model that is not Anthropic's. This is a **different file** from the
per-directory one, and the rules below were measured against a working setup — each of them breaks
the session in a way that is hard to diagnose from inside it.

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

- **Never write the API key into this file, or into any file.** `tokenEnv` is the *name* of an
  environment variable; the key belongs in the shell that starts the server, or a `.env` beside it.
  If the user pastes a key at you, tell them where it goes — do not store it.
- `baseUrl` must **not** end in `/v1`. Claude Code appends `/v1/messages` itself, so a trailing
  `/v1` produces `/v1/v1/messages` and every request 404s.
- Keep `maxOutputTokens` at 16000 or above. A thinking model given less spends the whole budget
  thinking and returns empty visible text, which reads as a hung session.
- This is a partial `POST /api/config` merge — write only `providers`, so the user's other settings
  survive.
- The server reads the environment at startup: after adding a key, it has to be restarted.
- Providers do not work in the Docker sandbox; say so rather than letting the user find out.

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
