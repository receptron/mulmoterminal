// The one script the embeddable Markdown preview runs (#2157) — see mdPreviewEmbed.ts for the policy
// that lets it run and nothing else. Its own module because it is pure text-building with no Node
// dependency, unlike the nonce beside it there.
import { EXTERNAL_HREF, isPreviewToken, MD_PREVIEW_FROM_FRAME, MD_PREVIEW_FROM_HOST, OTHER_SCHEME_HREF } from "../../common/mdPreviewMessage.js";
import { CODE_BLOCK_ATTR } from "../../common/previewCodeBlocks.js";

/** How long the document sits on a burst of scrolling before reporting where it ended up.
 *  `setTimeout` rather than `requestAnimationFrame` deliberately: the pane hides this iframe with
 *  `display:none` when the reader switches back to the editor, which stops animation frames — the
 *  last scroll before that switch is exactly the position worth keeping. */
const SCROLL_REPORT_MS = 120;

/** How long after putting the reader back the document stays quiet about where it is.
 *
 *  Restoring scrolls, and scrolling reports — so without this the document answers its own
 *  restore. That is not merely redundant: a place past the end of a document that has not
 *  finished growing is CLAMPED by `scrollTo`, so the echo would tell the host a smaller number
 *  than it just sent, and the place would be lost by being restored. */
const RESTORE_SETTLE_MS = 250;

/** The reporter itself, as it is written into the document.
 *
 *  It reports where the reader is and puts them back where the host says, and it holds no state
 *  the host does not send: a document that has just loaded knows nothing, so it announces itself
 *  and the HOST answers with the place. That inversion is what makes a re-render (the file
 *  changed on disk, so the iframe reloaded) land where the reader was rather than at the top.
 *
 *  `event.source !== parent` is the only check it can make: its own origin is opaque, so the host
 *  it posts to cannot be named by origin either — hence the `"*"` target, carrying a scroll
 *  offset and nothing else.
 *
 *  The subtleties are one thing: a `scrollTo` into a page with no room for it yet is CLAMPED, so
 *  the place is lost by being applied. The quiet window covers the consequence — a clamped
 *  position must never be reported back as the reader's, or the restore overwrites what it was
 *  restoring — and the ResizeObserver covers the cause, by applying the place again whenever the
 *  page grows under it.
 *
 *  It has to be the page's own HEIGHT that is watched, and it has to be the DOCUMENT watching.
 *  Two things make a place arrive too early, and neither is visible from outside: images here are
 *  sized from the viewport and declare no dimensions, so the page grows as they load; and the pane
 *  hides this frame with `display:none` when the reader switches to the editor, which leaves the
 *  document with no layout at all — every `scrollTo` clamps to the top, so a place that arrives
 *  then (the pane coming back in the editor, the file changing on disk behind it) is taken and
 *  lost. Measured rather than reasoned: `resize` does NOT fire on the way back, because the
 *  frame's `innerHeight` never changed — only `scrollHeight` did, from one viewport to the whole
 *  document. A host-side re-send when the preview is shown does not work either: `display` going
 *  back is not layout having happened, and it passed one run in three.
 *
 *  The re-apply stops once the reader has scrolled for themselves, because from then on the
 *  remembered place is no longer where they are — and it stops on their scroll EVENT rather than
 *  on the report of it, which is throttled. The gap between the two is a window in which the next
 *  image to land would pull them back to a place they had already left. */
// A heading the host's outline picked (#2576): by position, checked against its text. When the position
// names another heading (the Preview drew one the source count missed), the `occurrence`-th with that
// text — the second "Usage" stays the second. It becomes the anchor the place follows.
const HEADING_LOOKUP = [
  "const headingFor = (index, text, occurrence) => {",
  "  const norm = (value) => String(value).replace(/\\s+/g, ' ').trim();",
  "  const all = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6'));",
  "  const at = all[index];",
  "  if (at && norm(at.textContent) === norm(text)) return at;",
  "  const same = all.filter((h) => norm(h.textContent) === norm(text));",
  "  return same[occurrence] || same.find((h) => all.indexOf(h) >= index) || same[0] || at;",
  "};",
];

// The page growing under the place (an image landing) re-applies it until the reader scrolls. Following
// a picked heading moves the place; the host hears it, so a reload restores where it went.
const GROWTH_WATCH = [
  "new ResizeObserver(() => {",
  "  if (readerMoved) return;",
  // Hidden (the pane shows the editor, `display:none`), the anchor has no box and measures 0: re-anchor
  // on that and the pick is lost, and posted it would overwrite the place the host restores on a reload.
  "  if (anchor && anchor.getClientRects().length === 0) return;",
  "  applyPlace();",
  '  if (anchor && place !== null) post({ kind: "scroll", scrollY: place });',
  "}).observe(document.documentElement);",
];

// A copy button on each code block the server numbered (#2615). It asks the HOST to show the block —
// the host takes the text from the file, so nothing here decides what is copied. Its name comes from
// the host, which knows the app's language; until then it is the icon alone. The DOM is reached through
// the prototypes: a `.md` can shadow `document.querySelectorAll` with `<img name=...>`, and a throw here
// must not take the rest of this script with it — which is also why it runs last.
const COPY_ICON =
  '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.2"><rect x="5.5" y="5.5" width="8.5" height="8.5" rx="1.5"/><path d="M10.5 3.5V3A1.5 1.5 0 0 0 9 1.5H3A1.5 1.5 0 0 0 1.5 3v6A1.5 1.5 0 0 0 3 10.5h.5"/></svg>';
const COPY_BUTTON_STYLE =
  "position:absolute;top:4px;right:4px;padding:2px 4px;line-height:0;border:1px solid currentColor;border-radius:4px;background:inherit;color:inherit;opacity:.6;cursor:pointer;user-select:none";
const CODE_COPY = [
  `copyButtons = Array.from(Document.prototype.querySelectorAll.call(document, 'pre[${CODE_BLOCK_ATTR}]')).map((pre) => {`,
  "  const button = Document.prototype.createElement.call(document, 'button');",
  "  button.type = 'button';",
  `  button.innerHTML = ${JSON.stringify(COPY_ICON)};`,
  `  button.setAttribute('style', ${JSON.stringify(COPY_BUTTON_STYLE)});`,
  // Room for the button, so it does not sit over the end of the first line.
  "  pre.style.paddingRight = '2.5em';",
  "  button.addEventListener('click', (event) => {",
  "    event.preventDefault();",
  // A block inside a link: the press is the button's, not the link's.
  "    event.stopPropagation();",
  `    post({ kind: "code-block", index: Number(pre.getAttribute('${CODE_BLOCK_ATTR}')) });`,
  "  });",
  // Beside the block rather than inside it: a block scrolled sideways would carry the button away.
  "  const holder = Document.prototype.createElement.call(document, 'div');",
  "  holder.style.position = 'relative';",
  "  pre.before(holder);",
  "  holder.append(pre, button);",
  // Opaque, in the block's own colours: the block now scrolls UNDER the button, not with it, and the
  // button no longer inherits the block's text colour from inside it.
  "  const blockStyle = getComputedStyle(pre);",
  "  button.style.background = blockStyle.backgroundColor;",
  "  button.style.color = blockStyle.color;",
  "  return button;",
  "});",
  "nameCopyButtons = (label) => copyButtons.forEach((button) => {",
  "  button.title = label;",
  "  button.setAttribute('aria-label', label);",
  "});",
];

// What the host says: the copy buttons' name (with the answer to `ready`, and again when the app's
// language changes), a heading to go to, or the place to hold.
const MESSAGE_LISTENER = [
  "addEventListener('message', (event) => {",
  "  if (event.source !== parent) return;",
  "  const data = event.data;",
  `  if (!data || data.source !== ${JSON.stringify(MD_PREVIEW_FROM_HOST)}) return;`,
  "  if (typeof data.codeCopyLabel === 'string') nameCopyButtons(data.codeCopyLabel);",
  "  if (typeof data.diagramSourceLabel === 'string') nameDiagramSources(data.diagramSourceLabel);",
  "  if (typeof data.heading === 'number' && typeof data.headingText === 'string') {",
  "    const occurrence = typeof data.headingOccurrence === 'number' ? data.headingOccurrence : 0;",
  "    const target = headingFor(data.heading, data.headingText, occurrence);",
  "    if (!target) return;",
  "    anchor = target;",
  "    readerMoved = false;",
  "    applyPlace();",
  '    post({ kind: "scroll", scrollY: place });',
  "    return;",
  "  }",
  "  if (typeof data.scrollY !== 'number') return;",
  "  anchor = null;",
  "  place = data.scrollY;",
  "  applyPlace();",
  "});",
];

const reporterSource = (token: string | null): string =>
  [
    "(() => {",
    // Every message carries the token this document was served with (#2515): the host takes only
    // messages with the token of the document it asked for, which a page this frame was navigated to
    // never had. `token` has passed isPreviewToken, and JSON.stringify quotes it either way.
    `const post = (message) => { parent.postMessage({ ...message, token: ${JSON.stringify(token)}, source: ${JSON.stringify(MD_PREVIEW_FROM_FRAME)} }, "*"); };`,
    "let place = null;",
    "let quietUntil = 0;",
    "let readerMoved = false;",
    "let pending = 0;",
    // The heading a pick went to, while the reader has not scrolled since: the place follows IT, so
    // an image that loads above it and pushes it down does not leave the pick on a stale pixel.
    "let anchor = null;",
    "const applyPlace = () => {",
    "  if (anchor) place = Math.max(0, Math.round(anchor.getBoundingClientRect().top + scrollY));",
    "  if (place === null) return;",
    `  quietUntil = Date.now() + ${RESTORE_SETTLE_MS};`,
    "  scrollTo(0, place);",
    "};",
    "addEventListener('scroll', () => {",
    "  if (Date.now() < quietUntil) return;",
    "  readerMoved = true;",
    "  anchor = null;",
    "  if (pending) return;",
    "  pending = setTimeout(() => {",
    "    pending = 0;",
    '    post({ kind: "scroll", scrollY: Math.round(scrollY) });',
    `  }, ${SCROLL_REPORT_MS});`,
    "}, { passive: true });",
    ...HEADING_LOOKUP,
    // Declared before the listener that names the buttons; filled in last (see CODE_COPY).
    "let copyButtons = [];",
    "let nameCopyButtons = () => {};",
    // The disclosure under each diagram (#2991) is in the document from the start, so it is named outright.
    "const nameDiagramSources = (label) => Array.from(Document.prototype.querySelectorAll.call(document, 'details.mermaid-source > summary')).forEach((summary) => { summary.textContent = label; });",
    ...MESSAGE_LISTENER,
    ...GROWTH_WATCH,
    // A link is handed to the host rather than followed, decided on the attribute as written. An
    // external one because the frame has no `allow-popups` and most sites refuse to be framed
    // (#2259); one to another file because the frame's URL is this server's route, so following it
    // is a 404 — the host opens it in a tab (#2268). An anchor, and a `mailto:` or other scheme,
    // keep their default.
    "addEventListener('click', (event) => {",
    "  const link = event.target instanceof Element ? event.target.closest('a[href]') : null;",
    "  const href = link ? link.getAttribute('href') : null;",
    "  if (!href || href.startsWith('#')) return;",
    `  const external = ${EXTERNAL_HREF}.test(href);`,
    `  if (!external && ${OTHER_SCHEME_HREF}.test(href)) return;`,
    "  event.preventDefault();",
    '  post(external ? { kind: "navigate", href } : { kind: "open", href });',
    "});",
    'post({ kind: "ready" });',
    ...CODE_COPY,
    "})();",
  ].join("\n");

/** The reporter as a `<script>` element carrying the nonce that lets it run.
 *
 *  Appended to the rendered body rather than placed in the head: the document it measures has to
 *  exist before `scrollTo` means anything, and this way the embeddable document differs from the
 *  plain one by exactly one trailing element. */
export const mdPreviewReporterTag = (nonce: string, token: string | null = null): string =>
  `<script nonce="${nonce}">${reporterSource(isPreviewToken(token) ? token : null)}</script>`;
