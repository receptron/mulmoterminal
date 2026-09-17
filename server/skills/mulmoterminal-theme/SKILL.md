---
name: mulmoterminal-theme
description: Build a colour scheme of your own for MulmoTerminal — one that joins Midnight, Nord, Daylight and Solarized in Settings' theme picker and can then be pinned per project. Writes `themes` in `~/.mulmoterminal/config.json`, the whole-app palette (panels, borders, accent, text), which has no UI for creating one — Settings only lets you pick from what exists. Use when the user wants their own theme, a dark/light variant that isn't shipped, a scheme drawn from a painting, a photo or a brand's colours, or says the built-in themes are too dark, too blue, too low-contrast. For colouring ONE project's cell (its badge and header), or assigning an existing theme to a directory, use mulmoterminal-dirs instead.
---

# Make a colour scheme of your own

`themes` in `~/.mulmoterminal/config.json` defines schemes that appear in Settings' picker next to
the four built-ins, and that a project can then name in its `.mulmoterminal.json` `theme` key.
Settings can *choose* a theme; nothing in the app can *create* one. This skill is that path.

This is the **whole app's** palette — panel backgrounds, borders, accent, text. A single project's
badge and header colours are a different thing (`mulmoterminal-dirs`).

## How to run this

### 1. Find out what they're going after

Ask for the direction first, with concrete options rather than "what colours?":

- **From something that exists** — a painting, a photo, a brand, an editor theme they like.
  This is the easiest to do well: take 5–8 colours off the source and assign them to roles.
- **A variant of a built-in** — "Nord but warmer", "Daylight with more contrast". Use `extends`
  and write only the keys that differ.
- **Light or dark**, if it isn't already obvious. It decides every value below.

### 2. Decide `extends` — and know what it costs

```jsonc
{ "id": "arles", "label": "Van Gogh (Arles)", "extends": "daylight", "colors": { "--accent": "#c8971e" } }
```

- **With `extends`**, `colors` is a diff over that built-in (`midnight` / `nord` / `daylight` /
  `solarized`). Anything you leave out is inherited. Start here — it is far easier to get right,
  and a three-key diff is a real theme.
- **Without `extends`**, the theme must set **every** one of the 20 keys below. This is enforced
  when the config is saved, not when the theme is painted: an incomplete theme with no base is
  **rejected outright** rather than half-applied, because the missing half would inherit whatever
  the previous theme left on the element.

### 3. Write the colours

Assign the source's colours to roles, then say what each one is doing before you write it. Rules
that matter more than taste:

- **`--text` on `--bg-base` and `--bg-panel` must stay readable.** Check the WCAG contrast ratio:
  gamma-decode each channel (`c/255`, then `c<=0.03928 ? c/12.92 : ((c+0.055)/1.055)^2.4`), weight
  `0.2126 R + 0.7152 G + 0.0722 B`, ratio `(lighter+0.05)/(darker+0.05)`. Aim for **4.5:1 or
  better** for `--text`, and don't let `--text-muted` fall below **3:1** — a beautiful palette that
  can't be read is the usual way this goes wrong.
- **`--on-accent` goes on `--accent-bg`, not on the page.** Check it against that, and nothing else.
- **A painting's colours are rarely usable raw.** Backgrounds want the muted, desaturated end of
  the source; the accent wants its most saturated note. Taking six vivid colours and putting them
  in six roles produces something unusable at 12px.

### 4. Write, then look

`themes` is a **partial `POST /api/config` merge** — write only `themes`, so the user's other
settings survive. Send the **whole array**, existing entries included: it replaces, it does not
append, and a lone new entry silently deletes the rest.

Then: **reload the tab**, open Settings, and pick the theme. It does not appear until the page
re-reads the config. If the file was hand-edited while the server was running, the server needs a
restart too.

Ask what to change and adjust. The picker is the real preview — apply and look, rather than
describing.

### 5. Offer to pin it, if that's what they meant

A theme is global. If the user wanted "this project in my new scheme", the second half is
`"theme": "<id>"` in that project's `.mulmoterminal.json` — hand off to `mulmoterminal-dirs`.

## Schema

```json
{
  "themes": [
    { "id": "arles", "label": "Van Gogh (Arles)", "extends": "daylight", "colors": { "--accent": "#c8971e" } }
  ]
}
```

| Field | Rule |
|---|---|
| `id` | **Required.** Lowercase letter first, then lowercase/digits/dashes, ≤ 32 chars (`^[a-z][a-z0-9-]{0,31}$`). It becomes a `data-theme` attribute value and is what a project's `theme` key names. |
| `label` | **Required.** What the picker shows, ≤ 40 chars after trimming. |
| `extends` | Optional: `"midnight"` / `"nord"` / `"daylight"` / `"solarized"`. Omit only if you set all 20 colours. |
| `colors` | Hex only — `#rgb` / `#rgba` / `#rrggbb` / `#rrggbbaa`. **A key outside the 20 drops the whole theme**, so check spelling before writing. |
| `term` | Optional. The xterm palette, set outright — see [The terminal palette](#the-terminal-palette-term) below. Same hex rule, and its own key vocabulary. |

**`id` must not be a built-in id.** `midnight`, `nord`, `daylight` and `solarized` are refused
rather than merged into — someone reading the guide's description of Midnight has to get Midnight.

The hex shape is doing security work in `colors`, not tidiness: those values land in CSS custom
properties, so one that escaped the shape would be injected into a style declaration. `term` goes
to a canvas instead, where the risk is different and still real — xterm throws on a colour it
cannot parse, and it throws while the whole theme object is being applied, so one bad string costs
every colour in the terminal. Never write anything but a hex literal in either — no `var(...)`, no
`color-mix(...)`, no named colours.

### The 20 keys

| Key | Role |
|---|---|
| `--bg-base` | The page behind everything — **and the terminal background**, which xterm takes from here |
| `--bg-deep` | The deepest chrome surface: side panes, overlays, inset boxes |
| `--bg-panel` | Panels, modals, the sidebar |
| `--bg-subtle` | A surface a step up from the panel |
| `--bg-elevated` | Cards, popovers, dropdowns |
| `--bg-input` | Text inputs and selects |
| `--bg-hover` | Hover on a row or button |
| `--bg-selected` / `--bg-selected-hover` | A selected row, and hovering it |
| `--border` | Every divider and outline |
| `--accent` | The accent colour as text/icon |
| `--accent-bg` / `--accent-bg-hover` | Accent as a filled background, and its hover |
| `--on-accent` | Text on `--accent-bg` |
| `--text` | Body text |
| `--text-secondary` / `--text-muted` / `--text-dim` | Progressively quieter text |
| `--term-fg` | Default terminal foreground |
| `--term-selection` | Selection in the terminal |

## The terminal palette (`term`)

`colors` reaches the terminal canvas only by derivation: background from `--bg-base`, text and the
cursor block from `--term-fg`, selection from `--term-selection`, and the character drawn ON the
cursor from `--bg-base`. That makes the cursor an inverted cell, which is the right default and
not always the wanted one.

`term` states the palette directly, in xterm's own key names:

```json
{ "id": "washi", "label": "Washi", "extends": "daylight",
  "colors": { "--bg-base": "#ece7dc", "--term-fg": "#2a2622" },
  "term": { "cursor": "#b0402a", "cursorAccent": "#fffdf8" } }
```

Reach for it in two situations, and otherwise leave it out — the derivation is usually right:

- **A cursor of its own.** `cursor` is the block, `cursorAccent` the character on it. **Write both
  or neither**: set only `cursor` and the character keeps the derived background, which may now be
  invisible on the new block colour. Check that pair for contrast the way you checked `--text`.
- **One ANSI colour different from the base.** Those 16 have no CSS variable at all, so before
  `term` the only way to change a single red was to give up `extends` entirely.

The keys are the same set a project's `.mulmoterminal.json` takes in *its* `colors` block:
`foreground`, `background`, `cursor`, `cursorAccent`, `selectionBackground`,
`selectionForeground`, `selectionInactiveBackground`, and `black` … `brightWhite`.

**`term` and `colors` do not share a vocabulary.** A CSS variable written into `term` — or an
xterm name written into `colors` — drops the whole theme, silently, at load. That is the mistake
to look for first when a theme you just wrote is missing from the picker.

A project's own `colors` block still wins over `term` for that project's cells. Widest to
narrowest: `extends` → what `colors` implies → `term` → the directory.

## When it doesn't take

Work down this list before changing colours:

- **The theme isn't in the picker** — the tab hasn't been reloaded, or the entry was dropped in
  validation. Settings names a selected-but-undefined theme explicitly; that message is the tell.
- **Nothing changed after picking it** — an `extends`-less theme missing keys never reached the
  config at all. Re-read `~/.mulmoterminal/config.json` and see whether the entry is actually there.
- **The whole array vanished** — a partial write. Always send `themes` complete.
- **One theme vanished** — a key outside its block's vocabulary, or a value that isn't a hex
  literal. Neither is ignored in place: the entry is dropped whole. A CSS variable inside `term`,
  or an xterm name inside `colors`, is the usual cause.
- **The theme is there but the terminal ignored a colour** — `colors` only reaches the canvas as
  background / foreground / selection / cursor. Anything else has to be in `term`.
