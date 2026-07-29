---
name: mulmoterminal-config
description: Create or edit a .mulmoterminal.json to customize how a directory looks and behaves in MulmoTerminal — its name badge, chrome colors, xterm palette, terminal font size and font family, position in the grid, attention sound, header buttons/chips, and which model/provider its sessions run on. Also configures the settings that have NO Settings-modal UI and live only in the global `~/.mulmoterminal/config.json`: an Anthropic-compatible backend (OpenRouter, Moonshot, a gateway), keyboard shortcuts (`keymap`, including copy/paste), copy-on-select (`copyOnSelect`, for "selecting text should copy it"), the Enter-vs-newline binding (`terminalSubmit`, the fix for "Shift+Enter submits instead of adding a line"), the terminal font (`fontFamily`, including a CJK-capable one for Japanese), and the periodic dev-work log. Walks a beginner through it: pick directories with checkboxes, start from a colour preset (warm / tropical / cool / bold), apply it and look at the real cell, then refine. Configures the current directory OR several of your recent MulmoTerminal directories at once. Use when the user wants to configure, theme, color-code, rename, resize or change the terminal font, control where a project sits in the grid, add header buttons/chips, or bind keyboard shortcuts for a project's terminal — for one project or across many — or when Enter/Shift+Enter behaves wrongly in the terminal, or the terminal text is too small/large (browser zoom is not the fix — it breaks xterm's grid alignment), or Japanese/CJK text in the terminal looks wrong or misaligns the box-drawing frames.
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
**Header chips** / **Attention sound** / **Which model it runs on** / **Keyboard shortcuts** / **Enter key behaviour** /
**Terminal font** / **Dev-work log**. Configure only what they ticked.

The last four are **global**, not per-directory, and none of them has a Settings-modal UI — they exist
only in `~/.mulmoterminal/config.json`, which is why this skill is the way a user finds them at all.
(The terminal font can *also* be pinned per directory; the global value is the one with no UI.)
Mention them when the user's complaint matches one (see each section below).

### 3. Choose a colour direction — preset first, never a blank hex

Read `palettes.json`. Ask for the **vibe** first (four options, one question):

**Warm** · **Cool** · **Bold** · **Neutral**

Describe each preset in that vibe (below), ask which one they want, then apply it. That's the
big-picture decision; the details come after.

### 4. How to show colours — the terminal is the only real preview

**Do not try to paint swatches with ANSI escape codes.** Claude Code does not render colour in tool
output, and a Bash child here has no controlling terminal (`/dev/tty` → `device not configured`), so
the user sees nothing. Verified — don't waste a turn on it.

What to do instead:

1. **Name the colours.** For each candidate give its hex values and one line on how it feels
   ("terracotta on near-black — cosy, low glare"). Don't try to draw a swatch — apply it (step 2)
   and let them look at the real cell, which is the only accurate preview anyway.
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

### Terminal font size — `fontSize`

The xterm font size in px for this directory's terminals, overriding the user's Settings value.
Integer, **8–32**. A value outside that range is clamped to the nearest end rather than dropped;
a non-number is ignored. Omit unless the user asked about size — a directory that inherits the
Settings value is the normal case.

Reach for this when the user says the terminal text is too small or too big, and especially if
they mention trying browser zoom: zoom desynchronises xterm's cell grid from the PTY (drifting
cursor, wrong wrap points), while `fontSize` re-fits and tells the process its new size.

### Terminal font — `fontFamily`

A CSS font-family stack for this directory's terminals, e.g. `"'Cica', 'MS Gothic', monospace"`,
overriding the global `fontFamily` in `~/.mulmoterminal/config.json`. Names are matched as the OS
lists them, first installed one wins. Validated as ONE unit: any unusable entry drops the whole
stack (CSS syntax characters are rejected, quotes must be a matching pair around a whole name), and
`monospace` is appended when no generic family is named.

**Ask which fonts they actually have before writing one** — an uninstalled name silently does
nothing, and that reads as the setting being broken. For CJK, prefer a face whose fullwidth glyphs
are exactly twice the Latin width (Cica, HackGen, Sarasa Mono J, Noto Sans Mono CJK JP, MS Gothic,
BIZ UDGothic); anything else tears the box-drawing frames an agent TUI is made of.

Most users want this **globally**, not per directory — it is the same font everywhere unless one
project's output is a different language. The global key has no Settings UI, so writing
`~/.mulmoterminal/config.json` is the only way to set it. **Tell the user to restart
`mulmoterminal`** after you write it: that file is read once at server startup, so unlike a
`.mulmoterminal.json` edit (which applies instantly **because you wrote it with Write/Edit** — that
tool call is the live-reload signal; there is no filesystem watcher) the global one does nothing
until a restart — and "I set it and nothing happened" is exactly how that reads.
### Grid position — `orderPriority`

An integer rank for the grid's **priority** sort mode (the toolbar's ordering button cycles
auto → manual → priority). **Lowest first**; negatives allowed. Directories that set nothing
sort last, keeping their existing order, so adding it to one project doesn't shuffle the rest.

Only that one mode reads it — a user who never switches the button sees no change. Say so when
you set it, or they will write the key and wonder why nothing moved.

Setting this across several directories at once is the natural case ("keep my main repos at the
top of the grid"), so ask for the whole list and assign spaced ranks (10, 20, 30 …) rather than
1, 2, 3 — it leaves room to slot a project in later without renumbering everything.

### Attention sound — `sound`

A **relative** path to an audio file **inside this directory** (e.g. `"./sounds/done.wav"`).
Absolute paths and `../` escapes are rejected. Omit for the built-in chime.

### Header buttons — `buttons`

An array (≤ 32) of action buttons for a running session's header. Each:

```json
{ "id": "build", "icon": "build", "label": "Build", "run": "shell", "cmd": "yarn build", "when": "isGitRepo", "order": 10 }
```

**Omit `buttons` entirely** to keep the built-in defaults (a file-path picker + an OS file-manager
reveal). Setting `buttons` — even to `[]` — **REPLACES** the defaults (it isn't merged on top), so the
array you write is the whole button row; re-add the file picker with `{ "run": "open", "open": { "pickFile": true } }`
or the in-app file explorer with `{ "run": "open", "open": { "files": "${dir}" } }` if you want them.

- `id` (required, unique), `label` (required), `run` (required): one of `"shell"` / `"input"` / `"open"`.
- `icon` — optional: a [Material Symbols](https://fonts.google.com/icons) name (`build`, `folder`, `bar_chart`).
  Prefer it. An `emoji` field also exists and wins when both are set, but this project uses icons only.
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

The header's **Skill** dropdown lists this directory's Claude skills (`.claude/skills`,
user + project scope) and runs the picked one in the session. `skills` is an **allowlist
that also sets the order**: an array (≤ 100) of skill slugs — only these appear, in this
order. **Omit `skills`** to show every discovered skill (working-dir skills first). Slugs
that don't resolve to a real skill are simply ignored.

```json
{ "skills": ["review-diff", "commit-msg"] }
```

### Closing summary — `appendSystemPrompt`

Whether this directory's sessions are asked to end a reply with a short summary of what was
asked, what was achieved and what was not. **Omit it to follow the global setting**, which is on
— see the global section below for what the instruction says and what changes without it.

```json
{ "appendSystemPrompt": false }
```

`true` / `false` only; a directory that sets it outranks the global value.

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
      "maxOutputTokens": 16000
    }
  ]
}
```

- **Do not write a `models` array unless the user names a model outside the built-in list.**
  Registering the provider is enough: every preset for that `id` (common/modelPresets.ts) shows up in
  the picker on its own. `models` exists only to ADD ids we have not measured — an empty array in the
  example teaches the user they must fill it in.
- **Never write the API key into this file, or into any file.** `tokenEnv` is the *name* of an
  environment variable; the key belongs in the shell that starts the server, or a `.env` in the
  directory it is started from.
  If the user pastes a key at you, tell them where it goes — do not store it.
- `baseUrl` must **not** end in `/v1`. Claude Code appends `/v1/messages` itself, so a trailing
  `/v1` produces `/v1/v1/messages` and every request 404s.
- Keep `maxOutputTokens` at 16000 or above. A thinking model given less spends the whole budget
  thinking and returns empty visible text, which reads as a hung session.
- This is a partial `POST /api/config` merge — write only `providers`, so the user's other settings
  survive.
- The server reads the environment at startup: after adding a key, it has to be restarted.
- Providers do not work in the Docker sandbox; say so rather than letting the user find out.

## Keyboard shortcuts — `keymap` in `~/.mulmoterminal/config.json`

Also the **global** file, not the per-directory one, and **there are no defaults**: with no `keymap`,
no shortcut exists and no key is intercepted. Every binding the user adds is a key the program inside
the terminal (Claude Code, `vim`, `less`, the shell) stops receiving — so ask before binding, and
never add one they did not request.

```json
{
  "keymap": {
    "zoom-next": "PageDown",
    "zoom-prev": "PageUp"
  }
}
```

| Action | What it does | Needs a zoomed cell |
|---|---|---|
| `zoom-toggle` | Enlarge / collapse — the only action that changes that; it enlarges whichever terminal the cursor is in | no |
| `zoom-next` / `zoom-prev` | Move the enlargement along the on-screen order | yes |
| `next-attention` | Move to the next terminal awaiting input, then finished-unreviewed, then idle — skipping cells mid-turn. Never enlarges or collapses | no |
| `terminal-new` | Add a terminal at the end (the toolbar's `＋`) | no |
| `terminal-new-adjacent` | Add one right after the current terminal, inheriting its cwd | yes |
| `terminal-close` | Close the current terminal | yes |
| `copy` | Copy the terminal's selection. Acts ONLY when something is selected, so `Ctrl+C` stays usable as interrupt — with no selection the key reaches the program untouched | no |
| `paste` | Paste into the terminal | no |

### Sending raw keys to the terminal — `keymap.send`

The actions above drive MulmoTerminal. `send` does the opposite: it puts **bytes straight into the
terminal**, so a key the shell or agent already understands can be reached from a key the keyboard
has. The motivating request was `Cmd+Right` for end-of-line on a Mac.

```json
{
  "keymap": {
    "send": [
      { "key": "Cmd+ArrowRight", "bytes": "\u0005" },
      { "key": "Cmd+ArrowLeft",  "bytes": "\u0001" }
    ]
  }
}
```

A **list**, unlike every action above, because each entry carries its own payload. Control characters
are written the way JSON writes them (`\uXXXX`) and are NOT re-interpreted — the value reaches the
program exactly as written.

| Want | `bytes` | Is |
|---|---|---|
| Start / end of line | `\u0001` / `\u0005` | `Ctrl+A` / `Ctrl+E` |
| Back / forward one word | `\u001bb` / `\u001bf` | `Alt+B` / `Alt+F` |
| Delete to end of line | `\u000b` | `Ctrl+K` |
| Escape | `\u001b` | `Esc` |

Two rules to state when writing one:

- **An action beats a `send` on the same keystroke, always** — they are decided in different places
  and the action is claimed first, so the `send` silently never fires. The server warns at startup.
- **Empty `"bytes"` is refused** and stops the server: it would take the key from the terminal and
  put nothing back.

**Offer one of these starter sets rather than inventing keys** — each is checked against the traps
below, and the guide documents them at
[Configuration → Keyboard shortcuts](https://receptron.github.io/mulmoterminal/guide/en/config.html#keymap):

| Set | Keys | Suits |
|---|---|---|
| Minimal | `zoom-toggle: F8`, `next-attention: F9` | Anyone starting out — the two that open the feature up |
| Arrows | `Alt+ArrowUp/Left/Right/Down` | **The safe cross-platform default; the only one to offer a Mac user unprompted** |
| tmux-flavoured | `Alt+z / n / p / a / c / x` | Someone with tmux muscle memory — but NOT on macOS (Alt+letter is dead there) |
| iTerm2-flavoured | `Cmd+Enter`, `Cmd+[` / `]`, `Cmd+d` | Mac users who think in iTerm2 panes |

- **Always bind `zoom-toggle` or `next-attention`.** Everything marked "yes" above needs something
  already enlarged, so a keymap without one of these two cannot be used without a mouse click first.
  Offer `next-attention` to anyone running several agents — it is the "take me to whoever called" key.
- Syntax is `Modifier+Modifier+Key`; modifiers are `Shift` / `Ctrl` (`Control`) / `Alt` (`Option`) /
  `Cmd` (`Command`, `Meta`), case-insensitive. The key is matched against the browser's
  `KeyboardEvent.key` — `PageDown`, `Home`, `ArrowUp`, `a` — and is **case-sensitive** for letters.
- **A malformed binding stops the server from starting**, naming the entry. So validate before
  writing: a stray `+`, a lone `Shift`, or an unknown modifier costs the user their whole app until
  they fix the file. Never guess a spelling — if unsure, ask them to press the key and read it off
  the devtools console (`addEventListener("keydown", e => console.log(e.key), true)`).
- **Modifiers match exactly.** Binding `PageDown` leaves `Shift+PageDown` with the terminal, which is
  how xterm's scrollback keeps working. Point this out when proposing `PageUp`/`PageDown`.
- **Do not propose `F1`–`F12` on a Mac.** macOS delivers no keydown for them by default (they are
  media keys), so the binding looks broken for reasons the user cannot see. If they insist, tell them
  it needs `Fn`+the key, or System Settings → Keyboard → Keyboard Shortcuts → Function Keys.
- **Do not propose `Option`+letter on a Mac** — `KeyboardEvent.key` reports the composed character,
  not the letter, so it never matches. `Option`+a non-printing key (`Alt+ArrowDown`) is fine.
- **Never propose `Cmd`/`Ctrl`+`W`, `+T`, `+N`** — the browser reserves them; the binding silently
  does nothing.
- Two actions on one keystroke only fires the first; the startup check warns, but do not write one.
- **`terminal-close` ends the session with no confirmation.** Only bind it if the user asks, and
  suggest a combination they will not hit by accident.
- This is a partial `POST /api/config` merge — write only `keymap`, so their other settings survive.
- After writing, tell the user they can check the result in **Settings → Keyboard shortcuts**, which
  lists every action and its binding (read-only).
- The browser reads the keymap on page load: **reload the tab** after writing. A hand-edit made while
  the server is running also needs a server restart before it reaches the page.

## Copy on select — `copyOnSelect` in `~/.mulmoterminal/config.json`

Reach for this when the user wants a mouse selection to reach the clipboard **without pressing
anything** — the PuTTY / iTerm2 behaviour, `copyOnSelect` in Windows Terminal. Global file, and off
unless written.

```json
{ "copyOnSelect": true }
```

- **Only write it if asked.** It changes the clipboard when the user may have only meant to
  highlight something while reading, which is why it ships off.
- It is **not** a replacement for the `copy` keymap action, and they coexist. Someone who selects
  with the keyboard still wants `copy` bound.
- **Over plain `http://` the browser gives the page no clipboard access at all** (the API is
  `https://`- and `localhost`-only). There is a fallback that works there, but it needs the terminal
  to still hold keyboard focus. If the user reaches MulmoTerminal at `http://<ip>:PORT` and reports
  that dragging does not copy, this is the first thing to check — not the setting.
- Whitespace-only selections and a repeat of the last text are deliberately not copied, so the
  user's existing clipboard survives an accidental drag. Say so if they report "it didn't copy" for
  either case.
- Partial `POST /api/config` merge — write only `copyOnSelect`.
- The browser reads it on page load: **reload the tab**, and restart the server if the file was
  hand-edited while it was running.

## Enter key behaviour — `terminalSubmit` in `~/.mulmoterminal/config.json`

Reach for this when the user says **"Shift+Enter submits my prompt instead of adding a line"** (or,
equivalently, "a bare Enter drops to a new line instead of sending"). That is the tell-tale sign
their Claude Code is on the reversed key binding, and it also makes the phone remote view's *send*
button only type the text without submitting it.

```jsonc
{ "terminalSubmit": "cr" }      // default: Enter submits, Shift+Enter makes a newline
{ "terminalSubmit": "esc-cr" }  // reversed: Enter submits with ESC+CR, Shift+Enter makes a newline
```

- **Do not set this speculatively.** `cr` is the default and correct for almost everyone. Only write
  `esc-cr` after the user confirms the symptom above — setting it wrongly breaks Enter the other way.
- The *meaning* is identical in both modes (Enter submits, Shift/Option+Enter makes a newline); only
  which bytes carry it differs, because that is what the user's Claude Code was rebound to.
- **Claude sessions only.** A shell, codex, or command cell always submits with a plain `\r` even in
  `esc-cr`, so a reversed setting never rewrites a shell's Enter. Say so if they ask.
- An invalid value falls back to `cr`, so a typo cannot leave Enter broken.
- Takes effect after a **tab reload** (keyboard) and a **server restart** (phone remote view).
- Partial `POST /api/config` merge — write only `terminalSubmit`.

## Cockpit roster line counts — `cockpitLines` in `~/.mulmoterminal/config.json`

The roster beside a zoomed terminal shows three lines per session — **summary** (what it's doing
now), **prompt**, **reply** — each clamped so a long roster still fits. The clamp is a trade: more
lines each means fewer sessions on screen. Defaults are `2 / 2 / 3`, unchanged from before the
setting existed.

```json
{ "cockpitLines": { "summary": 6, "prompt": 2, "response": 3 } }
```

- Each field is a whole number in **1–20**. A number outside that range is **clamped** into it and
  a fractional one is **rounded** — the same contract as `fontSize`, because on a bounded number
  the user asked for a direction. Non-numeric falls back to that field's default, **per field**,
  so one typo doesn't discard the others.
- Hovering a line shows the full text regardless, so raising the clamp is a convenience.
- **Global** (`~/.mulmoterminal/config.json`), not per-directory: the roster mixes sessions from
  every directory, so a per-directory value would make neighbouring rows disagree.
- Takes effect after a **tab reload**.
- Partial `POST /api/config` merge — write only `cockpitLines`.

## Closing summary — `appendSystemPrompt` in `~/.mulmoterminal/config.json`

Every session MulmoTerminal starts is asked to end a reply with a short summary — **what was
asked, what was achieved, what was not** — under a `---` rule. It exists for the grid: coming back
to a cell later, that is otherwise only recoverable by scrolling the whole session.

```json
{ "appendSystemPrompt": false }
```

- **On by default**, and only an explicit `false` turns it off — a config that predates the
  setting keeps the instruction.
- **Nothing in the app reads what the summary says.** Turning it off costs no feature; the "last
  reply" in the roster and in push notifications just becomes the raw tail of the reply.
- Applies to **sessions started from then on** — no server restart, but a running session keeps
  what it was launched with. Reopen a cell to see the change.
- A directory's `.mulmoterminal.json` **wins** over this (see `appendSystemPrompt` above).
- Independent of `prWorkdirFooter`: both ride on `--append-system-prompt`, and turning one off
  leaves the other.
- `true` / `false` only. There is **no way to substitute custom wording** — do not offer one.
- Partial `POST /api/config` merge — write only `appendSystemPrompt`.

## Dev-work log — `worklogEnabled` / `worklogIntervalHours`

A built-in scheduled task, **off by default**. When on, it fires every `worklogIntervalHours` and
spawns a Claude session that merges recent work across the user's saved working dirs (`cwdPresets`),
grouped by repository, into weekly wiki pages.

```json
{ "worklogEnabled": true, "worklogIntervalHours": 6 }
```

- **Say the cost out loud before enabling it**: each run spawns an LLM session, so this spends tokens
  on a schedule whether or not the user is at the keyboard. Never turn it on unprompted.
- `worklogIntervalHours` is clamped to **1–168** (one week) and rounded; anything invalid becomes the
  default **6**. Offer a longer interval to anyone worried about cost.
- It reads `cwdPresets`, so it is worth nothing until the user has launched terminals in a few
  directories. Check that list before offering it.
- The batch scaffolds its own wiki pages and state file — the user only flips the flag.
- Partial `POST /api/config` merge — write only these two keys.

## Example result

A warm-clay project with buttons chosen to match what the directory supports:

```json
{
  "name": "my-project",
  "badgeColor": "#d97757",
  "headerColor": "#2b1a12",
  "headerTextColor": "#f7e6dc",
  "theme": "midnight",
  "colors": { "background": "#171210", "foreground": "#ece2dc", "cursor": "#d97757" },
  "buttons": [
    { "id": "compact", "icon": "compress", "label": "Compact", "run": "input", "text": "/compact", "when": "agent == claude" },
    { "id": "diff", "icon": "difference", "label": "Diff", "run": "open", "open": { "view": "diff" }, "when": "isGitRepo" },
    { "id": "reveal", "icon": "folder", "label": "Reveal", "run": "open", "open": { "reveal": "${dir}" } }
  ]
}
```
