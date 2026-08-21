# Make the page look like somebody made it

The page is the whole product. Nobody sees `app.json`, nobody sees the schema, nobody sees the
rules that keep a stranger from writing somebody else's row. They see one document, and they
decide what this is from it — so a page that arrives as unstyled boxes does not read as *plain*,
it reads as *unfinished*, and an unfinished-looking booking form is one people close.

This file is the rules. The templates each apply them at their own colour; what is here is why,
and how to go further than the fifteen lines they ship with.

## The constraint, first, because it decides everything else

A view runs in `sandbox="allow-scripts"` under a CSP that permits **nothing external**:

    default-src 'none'; style-src 'unsafe-inline'; img-src data:; script-src 'unsafe-inline'; connect-src 'none'

No CDN. No Tailwind, no Bootstrap, no icon set. No `@font-face` — `font-src` is not in the policy
at all, so a webfont silently falls back to something you did not choose. No `<img src="https://…">`
— `img-src` is `data:` and nothing else, so a remote image is not a broken icon, it is **nothing**,
with no error anywhere the author will look.

That policy is not an oversight and is not going to be widened. The same HTML runs in a stranger's
browser, and every host it contacts is a third party learning that this visitor opened this page.

So everything below is CSS you write, inline, in the page. Take that as the floor and not the
ceiling: the best-looking page this project has measured is **6.2KB of hand-written CSS with zero
external references**. The constraint is not what makes pages ugly. Not deciding is.

## 1. Choose a hue before you write a rule

Not a palette — one number, from what the app is *about*. A tennis board is a court's green. A
salon is not. A live poll is not.

Do this first because the alternative is not "choose later", it is grey: every page that skipped
this step came out in the neutral that was already on the screen, and neutral is what "nobody
decided anything here" looks like.

## 2. Derive everything else from that one number

    :root {
      --hue: 95;                                  /* THE decision. Everything below reads it. */
      --main: oklch(47% .09 var(--hue));           --fill:  oklch(96% .018 var(--hue));
      --line: oklch(47% .09 var(--hue) / .16);     --ink:   oklch(23% .015 var(--hue));
      --muted: oklch(53% .02 var(--hue));          --paper: oklch(99.4% .007 85);
    }

Six roles, one decision. Change `--hue` and the whole page moves together; there is nothing else
to keep in sync, which is exactly what breaks when six colours are picked one at a time.

**Why `oklch()` and not hex.** Because hex cannot be parameterised — there is no way to write
`#var(--hue)`. Deriving a palette needs a colour function that takes components, which leaves
`hsl()` and `oklch()`, and `hsl()`'s lightness is not lightness. `hsl(60 100% 37.5%)` and
`hsl(240 100% 37.5%)` claim the same lightness and are **41 points apart** in perceived
lightness — so an `hsl()` palette that looks right in blue is washed out in yellow, and every
hue has to be re-tuned by hand.

`oklch()` is perceptually uniform, so the same numbers hold across hues. Measured over the six
template hues (25, 65, 230, 265, 295, 330) and this file's own 95, with the values above unchanged:

| pair | contrast across all seven |
|---|---|
| `--ink` on `--paper` | 16.6 – 16.7 |
| `--muted` on `--paper` | 5.2 |
| `--paper` on `--main` (button text) | 6.6 – 7.0 |
| `--ink` on `--fill` | 15.0 – 15.1 |

Every one clears WCAG AA, and the spread across seven completely different colours is under 0.5.
That is the property being bought: **pick any hue and the page is still readable**, with no
per-colour tuning and no accessibility check to redo.

**Two things are not derived, on purpose.** `--paper` is a warm near-white pinned at hue 85 —
deriving it from `--hue` gives a cold blue-grey paper for cool apps, which looks worse in every
one of them. And out-of-gamut combinations are gamut-mapped by the browser rather than failing,
but keep `--main` at `.09` chroma and it stays inside sRGB for every hue; cyan (roughly 190–220)
is the region that cannot hold more.

Hand-picked hex is allowed and can beat this. The rule is *one hue, derived*, not *use oklch*.
The best page measured here was hand-picked hex — and converting it showed its ink, its muted
grey, its main and its pale fill all sitting on hue 156–158. It was doing this by hand.

## 3. States come in pairs, and they get their own hues

A status needs a background **and** a foreground, decided together:

    .pill        { padding: 3px 8px; border-radius: 999px; font-size: 11px; font-weight: 750; }
    .pill.open   { background: oklch(95% .04 155); color: oklch(42% .10 155); }
    .pill.doing  { background: oklch(95% .04  55); color: oklch(45% .12  55); }
    .pill.done   { background: oklch(95% .04 235); color: oklch(45% .08 235); }

Note these are *not* `--hue`. The base palette is one hue so the page holds together; the states
are separate hues so they can be told apart at a glance. Deciding only the text colour is what
produces the unreadable combination the day a fourth state is added.

## 4. Big text is tighter. Small headings are wider.

    h1       { font-size: clamp(24px, 5vw, 34px); line-height: 1.15; letter-spacing: -.03em; }
    .eyebrow { font-size: 12px; font-weight: 800; letter-spacing: .16em; }

Default tracking is tuned for body text. Left alone at 34px it reads as body text that happens to
be large, which is the single most common reason a page looks undesigned.

## 5. `clamp()` instead of breakpoints

    h1     { font-size: clamp(24px, 5vw, 34px); }
    .hero  { padding: clamp(24px, 5vw, 48px); }

On the size *and* the padding. Two `clamp()` calls replace the media queries that would otherwise
accumulate, and there is no width at which the layout is between rules and wrong.

## 6. Radius and shadow descend with the nesting

    .hero  { border-radius: 28px; box-shadow: 0 18px 50px oklch(30% .05 var(--hue) / .10); }
    .panel { border-radius: 24px; box-shadow: 0 18px 50px oklch(30% .05 var(--hue) / .10); }
    .stat  { border-radius: 18px; box-shadow: 0  8px 26px oklch(30% .05 var(--hue) / .06); }
    .row   { border-radius: 14px; }
    .pill  { border-radius: 999px; }

Outer is larger. One radius and one shadow everywhere is what makes a page look flat — the depth
cue is the *difference*, not the shadow.

## 7. Borders are the hue at low alpha, never grey

    border: 1px solid var(--line);   /* = the main colour at 16% */

A grey rule on white is a wireframe. The same line in the page's own colour disappears into the
design, and it is most of the reason a coloured page looks deliberate rather than decorated.

## 8. Use the weights between the two you know

    font-weight: 750;   /* not 700 */
    font-weight: 780;   /* a row title */

`system-ui` is a variable font on every platform this runs on, so 750 and 780 exist and render.
400-or-700 is two steps; a page that needs a third has one.

## 9. There are no images. Draw.

`img-src` is `data:` only, so decoration is CSS or it does not exist. It is enough:

    .hero::after {                    /* a thick ring, half off the corner */
      content: ""; position: absolute; right: -92px; top: -88px;
      width: 260px; height: 260px; border-radius: 50%;
      border: 32px solid oklch(92% .16 var(--hue) / .75);
    }
    body {                            /* light falling from one corner */
      background:
        radial-gradient(circle at 88% -8%, oklch(92% .16 var(--hue) / .48), transparent 30rem),
        linear-gradient(180deg, oklch(98% .01 var(--hue)) 0, oklch(96% .012 var(--hue)) 100%);
    }

Give the container `position: relative; overflow: hidden` so the ring is cropped by its box.

## 10. The phone gets one column and full-width buttons

    button { min-height: 38px; touch-action: manipulation; }
    @media (max-width: 680px) {
      .row    { grid-template-columns: 1fr; }
      .btn    { width: 100%; }
      .btn.small { width: auto; }
    }

`min-height: 38px` because a 30px button is a miss on a phone. `touch-action: manipulation`
because without it every tap waits 300ms for a possible double-tap, which reads as lag.
Full-width for the action that matters, `auto` for the secondary ones — all of them full-width
makes a column of identical bars with no primary.

**And start the sheet with `* { box-sizing: border-box; }`.** Every template does. A browser's own
stylesheet already gives text inputs `border-box`, so the controls in these sheets do not overflow
without it — measured, at 375px, 0px of overflow either way. The line is not for them. It is for the
first padded `width: 100%` box you add yourself: the default is `content-box`, so the padding and
the border are added OUTSIDE the width, and a card with `padding: 14px 16px` pushes 34px past the
column it is in. Forcing `content-box` on the shipped controls reproduces exactly that — 6px of
horizontal scroll on a phone — which is the failure the line removes for everything you write next.

## Do not ship this file's colours

`--hue: 95` above is this document's, and no template uses it. If `95` survives into a page you
wrote, rule 1 did not happen — and a test in this repository fails on it, because a file that
only *asks* to be re-coloured gets copied verbatim anyway.

The same goes for the six templates: each ships a different hue precisely so that copying one does
not make every app in the world the same colour. Change it to yours.
