# Styling: Tailwind-first, tokens shared, CSS minimal

The app is styled with **Tailwind utility classes** driven by the theme's design
tokens. Prefer utilities on the element over per-component `<style scoped>`. The
goal: less CSS, and markup that carries its own styling so copy-pasting or
extracting a component never leaves CSS behind.

## How it's wired

- **`src/style.css`** — the design tokens. Four themes (`midnight`/`nord`/`daylight`/`solarized`)
  each redefine the same `--bg-*` / `--text-*` / `--border` / `--accent` / status
  vars under `:root[data-theme="…"]`. Switching `data-theme` on `<html>` recolors
  everything. This is the single source of color truth.
- **`src/tailwind.css`** — enables Tailwind for the app and maps those tokens into
  Tailwind's namespace with `@theme inline`, so the utilities resolve to the same
  vars and theme-switch for free. It pulls in **theme + utilities only — no preflight**:
  the app has its own reset in `style.css`, and adding Tailwind's base reset would
  restyle every existing component. (The plugin Shadow DOM has a separate Tailwind
  build — `src/plugin-tailwind.css` — don't confuse the two.)
- **`src/main.ts`** imports both, globally.

## The utilities you get

Names drop the CSS-property prefix so they read naturally:

| token (`style.css`) | utilities |
|---|---|
| `--bg-base` / `-deep` / `-panel` / `-subtle` / `-elevated` / `-input` | `bg-base`, `bg-elevated`, … |
| `--bg-hover` / `--bg-selected` | `hover:bg-hover`, `bg-selected` |
| `--border` | `border-border` |
| `--accent` (`--accent-bg`, `--on-accent`) | `bg-accent`, `text-accent`, `border-accent`, `bg-accent-bg`, `text-on-accent` |
| `--text` / `-secondary` / `-muted` / `-dim` | `text-fg`, `text-secondary`, `text-muted`, `text-dim` |
| status `--ok` / `--warn` / `--amber` / `--err` / `--err-text` | `text-ok`, `bg-warn`, … |
| font families | `font-sans` (system-ui), `font-mono` (JetBrains Mono) |

Spacing/radius use Tailwind's scale on a 4px base: `px-2` = 8px, `px-2.5` = 10px,
`px-3.5` = 14px, `rounded-md` = 6px, `rounded-lg` = 8px.

## Rules

1. **Default to Tailwind utilities.** New or changed markup gets utility classes,
   not a fresh `<style scoped>` block.
2. **Prefer a token over a raw hex.** Where a token exists, `bg-elevated` beats
   `bg-[#20203a]` — the token is what theme-switches, so the arbitrary hex would be a
   regression. **But** when a color is *already* hardcoded in the scoped CSS and has no
   token — a deliberate fixed color like a status green or a terminal palette —
   `bg-[#hex]` / `text-[#hex]` is a faithful move: it deletes the scoped rule without
   changing behavior (the color didn't theme-switch before and still won't). If such a
   color *should* theme-switch, promote it to a token in `style.css` instead — but
   that's a visual change on the other themes, a separate decision from the refactor.
   Arbitrary values for *dimensions* Tailwind's scale lacks (`py-[5px]`, `max-w-[16ch]`,
   `bg-[color-mix(...)]`) are always fine.
3. **Shared custom CSS goes global, once.** If a pattern genuinely can't be utilities
   and repeats across components, add it to `style.css` (a token or a shared class) —
   as one shared design primitive, not a copy per component.
4. **No descendant selectors across the styling boundary.** `.parent .child { … }` in
   a scoped block breaks the moment `.child`'s markup moves. Style the child element
   directly with its own utilities so the style travels with it.
5. **Tests select by role / `aria-label` / text or `data-testid`, never by a styling
   class.** Utilities aren't stable selectors, and coupling tests to styling is what
   breaks them on a restyle. Add `data-testid` when there's no accessible name.

## Gotchas (learned the hard way)

- **`text-{size}` bundles a `line-height`.** `text-xs` sets font-size **and**
  line-height. To match a design that set only `font-size: 12px`, use `text-[12px]`
  (or add an explicit `leading-*`). Otherwise the element's height shifts.
- **No preflight means buttons don't inherit `font-family`.** Set `font-sans` /
  `font-mono` explicitly on a button when it needs the app font — the browser default
  otherwise applies (this matches how the app already behaved pre-Tailwind).
- **Vertical padding relies on the reset.** `px-2` alone leaves vertical padding at 0
  because `style.css`'s `* { padding: 0 }` already zeroed it; that's intended.
- **`truncate`** = `overflow: hidden` + `text-overflow: ellipsis` + `white-space: nowrap`
  in one class.
- **Unlayered scoped CSS beats layered utilities.** An existing `<style scoped>` rule
  wins over a Tailwind utility at equal specificity, so when migrating an element you
  must *remove* its scoped declarations, not just add the utility.
- **Global CSS must live in `@layer base`, or it silently kills utilities.** Unlayered
  author CSS beats *every* layered utility regardless of specificity — a bare
  `* { margin: 0; padding: 0 }` disables **every** `p-*` / `m-*` class app-wide, and an
  unlayered `.material-symbols-outlined { font-size: … }` disables every icon `text-*`.
  `style.css` therefore wraps its resets in `@layer base` and pulls the Material Symbols
  package in with `@import … layer(base)`. Third-party CSS imported from JS is unlayered:
  import it from CSS with `layer(base)` instead.
- **Verify that a utility *wins*, not just that it exists.** Grepping the built CSS for
  `.px-2\.5{…}` only proves it was generated. Confirm the rendered `getComputedStyle`
  matches the original declaration — that is what catches a cascade-layer loss.

## Migrating an existing component

1. Add the equivalent utilities to the element (verify each against the original
   declaration — the built CSS shows what a utility resolves to). Convert *every*
   declaration, including ones the global reset also covers — e.g. a list's explicit
   `margin: 0; padding: 0` → `m-0 p-0`. The `*` reset does zero them (so dropping them
   renders identically), but keeping them explicit is faithful, survives a reset change,
   and doesn't read as a regression to a reviewer who forgets `list-none` isn't a reset.
2. Delete the now-dead scoped rules **and** any descendant selectors that targeted the
   element's children (move those onto the children as utilities).
3. **Before deleting a class, grep the *whole repo* for it — not just this component's
   spec.** A class you think is local is often asserted on by *another* component's
   test (a parent that renders this one). Removing `.cell-model` passed
   `ModelContextBadge.spec` but broke three assertions in `TerminalCell.spec`, which
   renders the badge. `grep -rn "class-name" src test`. Then re-point every hit to an
   accessible selector or `data-testid`. When a parent needs to find a child, give the
   child a `data-testid` rather than reaching for a styling class.
4. Confirm the built utility declarations match the originals; screenshot across the
   four themes if it's visually load-bearing.

Migration is incremental — touch a component, Tailwind-ify what you touch.
