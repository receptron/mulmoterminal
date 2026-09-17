---
name: mulmoterminal-dirs
description: Colour-code and order the directories you actually work in, from wherever you are. Writes each project's `<project>/.mulmoterminal.json` — name badge, project icon image, the seven chrome colours, xterm palette (`theme` / `colors`), terminal font size, `orderPriority` (where it sits in the grid and in the launcher's chips), and `worktreeEnv` (a value of its own per git worktree for each declared variable — a dev-server port, a database name — so two `yarn dev` do not fight over 3000). Starts from your recent MulmoTerminal directories rather than just the current one, reads the configs you already have, works out the convention you have been following, and continues it for the ones that are unset or off-pattern — so a newly cloned repo gets the colour and rank it should have had. Also owns what the header shows once a STATUS takes the background over — `headerStatusColors` (a colour per working / done / blocked) and `headerStatusTint` — in a project's file and as the global default in `~/.mulmoterminal/config.json`. Use when the user wants to colour-code, theme, rename, reorder, or resize projects in MulmoTerminal — "give this project a colour", "colour-code my repos", "keep my main repos at the top", "the new clone has no colour", "make them consistent", "terminal text is too small", "two worktrees fight over port 3000", "give each worktree its own port / database" — or when the header is hard to read or changes colour while a session is running — "I can't read the header while it's working", "the colour changes when it runs", "keep my header colour while running". For inventing a NEW reusable colour scheme that shows up in Settings, use mulmoterminal-theme instead.
---

# Colour and order the directories you work in

MulmoTerminal reads `<project>/.mulmoterminal.json` to style every terminal opened in that
directory. There is **no UI that writes this file** — this skill is the way it gets written.

Two files ship next to this one:

- `palettes.json` — colour presets grouped by vibe, for a user with nothing configured yet.
- `dir-config.schema.json` — the generated JSON Schema. "Schema" below matches it.

## The shape of this conversation

The unit of work is **the set of directories the user actually opens**, not the current one. Someone
who colour-codes projects is doing it so the grid is readable at a glance, and that only works if the
colours are decided against each other.

So: gather → infer → propose the whole set → apply → look → adjust.

Ask with `AskUserQuestion`, one decision at a time, always with concrete options. A beginner should
never have to invent a hex code.

### 1. Gather — the directories, and what they already say

Read `~/.mulmoterminal/config.json` and take `cwdPresets` (`[{ label, path }]`, most-recent first —
the same list the New-terminal launcher offers). That is the population. Worktrees are not recorded
into it, so it is the user's real projects rather than every task branch they have ever opened; an
older entry that still names one is theirs to keep or remove, not this skill's to prune.

Then, for **each** of those paths:

```sh
curl -sG "http://localhost:${MULMOTERMINAL_PORT:-34567}/api/dir-config-detail" --data-urlencode "cwd=$path"
```

Let `curl` encode `cwd` (`-G` + `--data-urlencode`) rather than interpolating the path into the
query: a raw path truncates at the first `#` or `?` and mangles spaces.

Use this route, not your own read of the file. It returns what the app **actually parsed**: the
values in force, the keys the file set, and how each fared — applied, dropped in validation, or not
a key we read. A hand-read tells you what the file says; only this tells you what is *in effect*,
and the difference is the entire content of "I set it and nothing happened". It also resolves the
path the way the app does (a preset whose project has since been deleted answers as missing rather
than silently reporting on some other directory).

If the server is not running, fall back to reading each `.mulmoterminal.json` directly and say that
you could not check what was dropped.

If there are no `cwdPresets` yet, this is a fresh install: configure the current directory from a
preset in `palettes.json` and stop.

### 2. Infer — work out the convention already in use

**Do not skip to a preset when the user already has configs.** They have a scheme; your job is to
find it and extend it, not to replace it. Convert every configured colour to HSL and look for:

- **One hue per directory?** In a hand-made scheme, a directory's seven colours are usually one hue
  at different saturations and lightnesses. Check whether the hues within a directory agree.
- **Fixed saturation/lightness per role.** `badgeColor` dark and saturated, `headerColor` a little
  lighter, `cellColor` near-white, `cellBorderColor` and `dotColor` mid, `buttonColor` pale — the
  numbers repeat across directories even when the hue does not. Take the median of each role.
- **Hue bands by repository family.** `foo`, `foo2`, `foo3` are clones of one repo and usually sit
  in one band, stepping by a constant number of degrees per clone, often getting lighter as the
  number goes up. That step is what tells you what `foo6` should be.
- **`orderPriority` spacing and blocks.** Ranks are typically multiples of 10, grouped so one repo's
  clones are contiguous. You need the step and the free numbers.

**Show the user the rule you found before you use it**, as a small table — hue per family, the S/L
per role, the rank blocks. This is the step where a wrong inference gets caught, and it costs one
message. If the configs are too few or too inconsistent to support a rule, **say so** and fall back
to `palettes.json`; do not invent a pattern from two data points.

### 3. Classify — who needs what

Sort the population into three, and name them to the user:

- **On-pattern** — leave alone. Never rewrite a directory that already fits.
- **Unset** — no colours at all. These are the point of the exercise: a repo cloned last week that
  shows up grey.
- **Off-pattern** — configured, but not by the rule (a different saturation, a hue outside every
  band). **Ask before touching these.** They may be deliberate, and rewriting someone's one
  intentionally-odd project is worse than leaving it.

### 4. Propose the whole set at once

Give each target its values, derived from the rule:

- **Hue** — the next step in its family's band, or a free band if the repo is new. Keep it clear of
  every hue already in use; adjacent projects in the grid must not read as the same colour.
- **The seven colours** — that hue at the role S/L you measured.
- **`orderPriority`** — the next free rank in its family's block. If the block is full, say so and
  offer either a gap-filling rank or a renumber of that block.

`headerTextColor` is **not** part of the hue rule — it is whichever of white or near-black is
readable on `headerColor`. Decide it by WCAG relative luminance, not by a brightness approximation:
gamma-decode each channel (`c/255`, then `c<=0.03928 ? c/12.92 : ((c+0.055)/1.055)^2.4`), weight
`0.2126 R + 0.7152 G + 0.0722 B`, and take whichever of black/white gives the higher contrast ratio
`(lighter+0.05)/(darker+0.05)`. The YIQ shortcut (`0.299/0.587/0.114` on raw channels) picks the
worse of the two for about 30% of colours — a vivid green header gets white text at 1.37:1, which is
unreadable. The app itself uses the WCAG rule (`src/components/contrast.ts`); match it.

### 5. Apply, then look at the real thing

Write each file, then let the user look. **The cells recolour immediately** — no page reload, no
server restart. Writing the file **with your Write/Edit tool is itself the reload signal**; there is
no filesystem watcher, so a file the user edits by hand does nothing until something re-reads it.

Do not try to preview colours with ANSI escapes. Claude Code does not render colour in tool output,
and a Bash child here has no controlling terminal (`/dev/tty` → `device not configured`). Verified —
don't spend a turn on it. Name the hex and say how it feels ("terracotta on near-black — cosy, low
glare"), then apply and let them look at the grid, which is the only exact preview.

**Read the existing file and merge before writing.** Never drop a key the user did not ask to change.

### 6. Refine, one axis at a time

Never "what colour do you want?". Offer: background darker / as-is / lighter · accent warmer /
cooler · header contrast subtle / strong. Apply and look after each. Two or three rounds is plenty.

The chrome colours only show while the cell is **idle** — the working/attention colours take over
while a session is busy or waiting on the user. Say this, or the user will change a colour, start a
session, and think nothing happened.

## An open file the whole ecosystem reads — `repo.json`

`<project>/repo.json` is an open repository-metadata format (`docs/repo-json.md`), not this app's
own file. MulmoTerminal reads it as the LOWEST layer, under both files below.

```json
{ "name": "diffusion-lab", "icon": "docs/logo.png", "color": "#7c3aed" }
```

`color` — one colour — becomes all seven chrome colours. `icon` becomes the cell icon. Anything
this app understands that the open format doesn't goes under `extensions.mulmoterminal`.

**Prefer it when the colour is the PROJECT's, not the user's.** A project with a real brand colour
should say so in `repo.json`, where every tool can read it and where the repository can commit it
for everyone. Reach for `.mulmoterminal.json` when the colour is a personal choice about how this
user's grid should look — which is most of what this skill does.

When you find a `repo.json` already in place, **read it before proposing colours**: the project has
stated its own, and overriding it in `.mulmoterminal.json` needs a reason you can give the user.

## Several clones of one repository — `.mulmoterminal.local.json`

`<project>/.mulmoterminal.local.json` is read AFTER `.mulmoterminal.json` and **replaces whatever
top-level keys it names**. The full order, general to specific, is
`repo.json` → `.mulmoterminal.json` → `.mulmoterminal.local.json`. Keys it does not name keep the shared value; a `colors` block replaces
the shared one entirely rather than merging into it.

This is the right shape whenever the population you surveyed contains **several checkouts of one
repository** (`foo`, `foo2`, `foo3` …) — which step 2 already looks for as a hue band:

- **`.mulmoterminal.json` gets the FULL config**, colours included. Somebody who clones the project
  once must end up with a working colour from this file alone, so do not reduce it to the shared
  half and leave the colours only in local files.
- **`.mulmoterminal.local.json` gets only what makes THIS checkout recognisable** — the seven
  chrome colours and `orderPriority`. It is per-machine, so **tell the user to gitignore it**.

When you write both, keep the shared file's colour as the family's first hue and let each clone's
local file step from there, so the repository's own file is not the odd one out.

The settings preview (`/api/dir-config-detail`, step 1) names both paths and returns
`source.local` — the keys the local file took over. Read it before concluding a directory is
off-pattern: a colour that disagrees with `.mulmoterminal.json` is usually the local file winning,
not a config that needs fixing.

## Schema — `<project>/.mulmoterminal.json`

All keys optional. Colours are lowercase `#rrggbb` unless noted. MulmoTerminal **silently drops**
anything malformed, so an invalid field just doesn't take effect — which is why step 1 checks what
was dropped rather than trusting the file.

### Identity and chrome colours

| Key | Meaning |
|---|---|
| `name` | Badge label (≤ 40 chars). |
| `icon` | An image marking this directory (see below). |
| `badgeColor` | Name-badge colour. |
| `headerColor` / `headerTextColor` | The cell header's background / text **while the cell is idle**. |
| `headerStatusColors` / `headerStatusTint` | What the header shows once a status takes over (see below). |
| `cellColor` | Cell body background. |
| `cellBorderColor` | Cell border. |
| `dotColor` | Idle status dot. |
| `buttonColor` | Header icon buttons. |

### The header while a session is running — `headerStatusColors` / `headerStatusTint`

`headerColor` is the **idle** colour. Once a session is working, done, or blocked, the theme
replaces the header background with its own wash — selection blue, a green mix, the warning
amber — so that the grid says whose turn it is from across the room.

That is why `headerTextColor` applies **only while the directory's own background shows**. An ink
chosen for a dark purple is not readable on a pale wash, which is the whole of #1591: white on
`#d6e4fb`, 1.15:1. Do not try to fix that by picking a compromise ink — set the status colour.

```jsonc
{
  "headerColor": "#8e44ad",
  "headerTextColor": "#ffffff",

  "headerStatusColors": {
    "working": "#6d28d9",                                  // shorthand: just the background
    "done": { "background": "#166534" },
    "blocked": { "background": "#7c2d12", "text": "#ffe8a3" }
  }
}
```

- **Only `working`, `done` and `blocked`.** There is no `idle` here — `headerColor` is idle.
- **Omit `text` and it is derived** from `background` by the same WCAG rule as `headerTextColor`
  above. Prefer omitting it: a background alone can never come out unreadable.
- A status you do not name keeps the theme's wash.
- Naming `text` **without** a `background` is allowed and left exactly as written — that is a
  statement about a wash you can see, so it is on you to check it.

`headerStatusTint: "none"` keeps `headerColor` in `working` and `done` instead of the wash. The
status still reads from the cell border, the status dot and the pill.

```jsonc
{ "headerColor": "#8e44ad", "headerStatusTint": "none" }
```

**`"none"` does not reach `blocked`.** That is the state where nothing proceeds until the user
answers, and a switch about palette consistency must not take its amber away. A directory that
genuinely wants another colour there writes `headerStatusColors.blocked`, which is honoured.

**Both keys also work in the global config** (`~/.mulmoterminal/config.json`), where they are the
DEFAULT for every directory — which is usually where they belong, since the readable pairing of a
wash and its ink is a property of the theme, not of one project. A `.mulmoterminal.json` that names
either key outranks the global value for that directory, whole-key: a directory's
`headerStatusColors` replaces the global block rather than merging into it.

### Project icon — `icon`

An IMAGE beside the name badge, in the cell header, the cockpit roster, the filmstrip thumbnails,
the launcher's directory chips, and the phone's terminal list and terminal screen. **Not** a
Material Symbols name — that is what a header BUTTON's `icon` is, and it is
`mulmoterminal-header`'s key, not this one.

- **A path is relative to this directory**, and confined to it: an absolute path, or a `../` that
  escapes, is dropped. Or an `http(s)://` URL, or a `data:image/…` URI (capped at 64 KB, since it
  rides in every cell's config fetch — point at a file for anything larger).
- PNG, JPEG, **GIF (animated ones play)**, WebP, AVIF, SVG, ICO, BMP. Any other extension is dropped.

Do not invent one. **Look for an image the repository already has** — `public/favicon.svg`,
`public/apple-touch-icon.png`, a web manifest — and offer what you found. A project with no logo
of its own is better served by the colour scheme; an icon that is not the project's own picture is
one more thing to recognise, which is the opposite of the point.

Prefer a file over a URL: a remote image is a request per cell to somebody else's host, and it
disappears when that host does. Prefer a **committed** file over a gitignored one — worktrees
inherit the key as written, so only a committed image is found in the worktree too.

**Usually you do not need to write this key at all.** MulmoTerminal already picks up a project's
own favicon when the key is absent — see below — so writing `"icon": "public/favicon.ico"` sets by
hand what was going to happen anyway. Write it when the repository's icon is somewhere the search
does not look, or when the project should show a different picture from its favicon.

### The favicon is picked up on its own — `autoDirIcon`

A directory that sets **no** `icon` shows the icon its repository already ships. Searched in this
order, first hit wins:

1. `public/favicon.svg`, then `favicon.svg`
2. `public/apple-touch-icon.png`, then `apple-touch-icon.png`
3. `public/favicon.png`, then `favicon.png`
4. `public/favicon.ico`, then `favicon.ico`
5. a web manifest (`public/site.webmanifest`, `public/manifest.json`, or either at the root) — its
   largest non-`maskable` icon

Ordered by how the image survives being drawn at 14px, not by how common it is. `docs/logo.png`
and `assets/logo.*` are deliberately NOT searched: a "logo" is as often a wide README banner as an
icon, and one of those squeezed into 14 square pixels reads as a smudge.

Two ways to turn it off, and they mean different things:

- `"icon": false` in a project's own file — "no icon on THIS project's cells". Worktrees inherit it.
- `autoDirIcon: false` in `~/.mulmoterminal/config.json` (or the checkbox in Settings → Directory
  appearance) — off everywhere. This is the one to reach for if the behaviour itself is unwanted;
  `"icon": false` in every repository is not.

**A key that was written and got it wrong does NOT fall back to the favicon.** `"icon": "logo.png"`
pointing at a file that isn't there leaves the cell with no icon at all, on purpose: a broken
setting has to look broken. If a project shows nothing where you expected a picture, check
`/api/dir-config-detail` (step 1) — the key will be in the `ignored` list.

### Terminal palette — `theme` and `colors`

The seven above tint the **chrome** around the terminal. These paint the **terminal contents**.

- `theme` — a palette id: one of the built-in `"midnight"` / `"nord"` / `"daylight"` /
  `"solarized"` (the id is `solarized`; "Solarized Light" is only its display label), **or the id of
  a scheme the user defined** in `themes` in `~/.mulmoterminal/config.json`. A directory naming a
  theme that isn't defined falls back rather than erroring, so check it exists. To create one, use
  the `mulmoterminal-theme` skill.
- `colors` — per-key overrides on top of `theme`. Keys are xterm ITheme names; values accept
  `#rgb` / `#rgba` / `#rrggbb` / `#rrggbbaa`. Valid keys: `foreground`, `background`, `cursor`,
  `cursorAccent`, `selectionBackground`, `selectionForeground`, `selectionInactiveBackground`, and
  the ANSI 16: `black` `red` `green` `yellow` `blue` `magenta` `cyan` `white` `brightBlack`
  `brightRed` `brightGreen` `brightYellow` `brightBlue` `brightMagenta` `brightCyan` `brightWhite`.
  Unknown keys are dropped. **This is per directory.** For the same override in every cell — one
  cursor colour across the whole app — the theme's own `term` block is the place
  (`mulmoterminal-theme`), and this block still wins over it here.

### Grid and launcher position — `orderPriority`

An integer rank. **Lowest first**; negatives allowed. Directories that set nothing sort last, keeping
their existing order, so ranking one project doesn't shuffle the rest. The rank belongs to the
*directory*, not the cell, so two cells on one directory share it.

It is read in **two** places:

- **The grid**, only in its **priority** sort mode (the toolbar's ordering button cycles auto →
  manual → priority). On auto or manual, nothing changes, whatever the projects declare — say this,
  or the user sets it and wonders why the grid looks the same.
- **The launcher's directory chips**, **always**, whichever mode the grid is on. The chips otherwise
  come in the order the directories were last launched, which moves under the user; ranking is how
  they get pinned. Unranked directories stay behind the ranked ones, in launch order.

Assign spaced ranks (10, 20, 30 …) so a project can be slotted in later without renumbering.

### Terminal font size — `fontSize`

Integer px, **8–32**, overriding the user's Settings value for this directory. Out of range is
**clamped** to the nearest end rather than dropped; a non-number is ignored. Omit unless asked —
inheriting the Settings value is the normal case.

Reach for it when the user says the terminal text is too small or too big, **especially if they
mention browser zoom**: zoom desynchronises xterm's cell grid from the PTY (drifting cursor, wrong
wrap points), while `fontSize` re-fits and tells the process its new size.

### Terminal font — `fontFamily`

A CSS font-family stack for this directory, e.g. `"'Cica', 'MS Gothic', monospace"`. Validated as
ONE unit: any unusable entry drops the whole stack, and `monospace` is appended when no generic
family is named.

Most users want this **globally** instead — it is the same font everywhere unless one project's
output is a different language. Both the global key and the per-directory one are covered here;
the global one lives in `~/.mulmoterminal/config.json`. **Settings → Terminal font sets it and it
applies at once** — point at that when the user just wants a different font. A HAND edit of that
file while the server runs still needs a **restart** (it is read once at startup), unlike this
file, which applies instantly.

**Ask which fonts they actually have before writing one.** An uninstalled name silently does
nothing, which reads as the setting being broken. For CJK, prefer a face whose fullwidth glyphs are
exactly twice the Latin width (Cica, HackGen, Sarasa Mono J, Noto Sans Mono CJK JP, MS Gothic, BIZ
UDGothic); anything else tears the box-drawing frames an agent TUI is made of.

### A port and a database name per worktree — `worktreeEnv`

A worktree isolates files, not **ports**. Two worktrees running `yarn dev` both reach for 3000 and
the second one dies; several pointed at one local database means the tree that runs a migration
breaks the rest. `worktreeEnv` declares what each working tree needs its OWN of, and MulmoTerminal
reserves a distinct value per tree and exports it into that tree's terminals.

```json
{
  "worktreeEnv": {
    "PORT": { "kind": "port", "base": 3000 },
    "DB_NAME": { "kind": "slug", "prefix": "myapp_" }
  }
}
```

| Field | Meaning |
|---|---|
| key | The variable name — whatever the project reads (`PORT`, `VITE_PORT`, `NEXT_PUBLIC_PORT`). Up to 16. |
| `kind: "port"` | A free TCP port: `base` + a multiple of 10. `base` is 1024–65215. |
| `kind: "slug"` | A `[a-z0-9_]` name from the tree's task (or folder) name, behind an optional `prefix`. Cut to 63 chars. |

The project's own checkout keeps `base` itself; its worktrees take `base+10`, `base+20`, … So a
project declaring 3000 sees 3000 where it always did.

Four things to say when you write this:

- **Ask which variable the project actually reads.** `PORT` is a guess. Look for it in
  `package.json` scripts, `vite.config.*`, `.env.example`, `docker-compose.yml` — a declaration
  under the wrong name is a setting that silently does nothing.
- **MulmoTerminal does not create the database.** It hands out a name nothing else holds; using it
  is the project's `migrate` script's job. Offer to wire that up only if asked.
- **Values are reserved once and kept** (`~/.mulmoterminal/worktree-env.jsonl`), so a running dev
  server's port never moves under it. Editing `base` later re-allocates every tree.
- **It IS carried into new worktrees**, unlike `sound` / `addDirs` — it is a declaration, not a
  value, so each tree resolves its own from it.

Each cell shows what it got on the header's `env` chip (`:3010`, clickable). The chip is on by
default and renders nothing where no `worktreeEnv` is declared, so there is nothing to switch on.

### Worktrees derive their own config from this one

A managed git worktree (`~/.mulmoterminal/worktrees/<repo>-<hash>/<task>`) gets its own
`.mulmoterminal.local.json` when MulmoTerminal creates it, derived from the project's: identity keys
(`name` / `icon` / `theme` / `colors` / `fontSize` / `fontFamily` / `provider` / `model` /
`worktreeEnv`) as written, the seven chrome colours rotated **12° further per worktree**, and
`orderPriority` at the project's rank **+ 1**. `sound` / `sounds` / `addDirs` are not carried.

Two consequences for this skill:

- **Leave worktree directories out of the population you survey.** Their colours are derived, not
  chosen, so reading them as data would infer a 12° family step that nobody decided on. Rank them
  and they collide with the +1 the app writes.
- **Recolouring a project does not recolour its existing worktrees** — the copy was taken when the
  worktree was created. Say so if the user asks why one cell kept the old colour, and offer to
  delete that worktree's `.mulmoterminal.local.json` so the next launch has nothing stale.
- **A worktree gets nothing when its repository gitignores NEITHER config file.** That is the
  check MulmoTerminal makes before writing, since an untracked file would make the worktree count
  as dirty and therefore unremovable. If a user's worktrees are all grey, a missing
  `.gitignore` line is the first thing to look at — `.mulmoterminal.local.json` is the one to add.

### Other keys in this file

`buttons` / `chips` → `mulmoterminal-header`. `provider` / `model` → `mulmoterminal-model`.
`sound` / `sounds` → `mulmoterminal-notify`. `skills` (the header Skill menu's allowlist and order),
`decks` (the header Mulmo menu's decks) and `appendSystemPrompt` (this directory's closing-summary
override) → `mulmoterminal-config`.
**Preserve them when you merge** — this skill writes appearance keys and must not drop the rest.

## Example — continuing a convention

Four clones of one repo, stepping ~13° per clone and getting lighter, ranks in one block of 10s.
The fifth is unset; these are the values that continue the rule:

```json
{
  "name": "acme-web5",
  "badgeColor": "#1f6f8b",
  "headerColor": "#2b93b8",
  "headerTextColor": "#231f16",
  "cellColor": "#f2fafd",
  "cellBorderColor": "#4fb4d4",
  "dotColor": "#4fb4d4",
  "buttonColor": "#cfeaf4",
  "orderPriority": 60
}
```
