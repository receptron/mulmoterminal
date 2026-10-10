// Markdown to sanitized HTML, for prose an AGENT wrote (#2112).
//
// Separate from wikiMarkdown.ts rather than shared with it, and the split is the point: that one
// renders a WIKI PAGE — it strips frontmatter, turns `[[links]]` into clickable spans before marked
// sees them, and rewrites image sources onto MulmoTerminal's raw-file route. None of that belongs to
// a conversation, and a `[[…]]` in a reply would become a link to a page that does not exist.
//
// What they DO share is the pipeline and the reason for it: marked, then DOMPurify, because the
// input is LLM-authored and reaches the DOM through `v-html`. Same sanitizer, same defaults, so a
// hardening applied to one is not silently missing from the other — the one thing worth keeping
// identical between them.
import DOMPurify from "dompurify";
import { parseMarkdown } from "./appMarked";

export interface ProseOptions {
  /** The one remote origin whose images may load. Only for markdown this repo ships (the release
   *  guides); an agent's reply never passes it, so its remote images stay links. */
  trustedImageOrigin?: string | undefined;
  /** Every image becomes a link, a same-origin one included: for markdown a stranger wrote, where a
   *  relative `src` is a request to this app's own routes the moment the page renders. */
  imagesAsLinks?: boolean | undefined;
}

/** Render `markdown` to HTML that is safe to hand to `v-html`.
 *
 *  EVERY LINK IS SENT TO A NEW TAB, and that is not decoration: MulmoTerminal is a single page
 *  holding live terminals, open panes and unsaved editor buffers, so an ordinary in-page navigation
 *  out of an agent's reply takes all of it with it and offers no way back. Agent replies are full of
 *  URLs. `rel` goes with `target` for the usual reason — an opened page must not reach `window.opener`
 *  — and it is set AFTER sanitizing so DOMPurify cannot be asked to allow an attribute we then have
 *  to trust it stripped correctly (Claude review, round 1). */
export function renderMarkdownProse(markdown: string, options: ProseOptions = {}): string {
  const clean = DOMPurify.sanitize(parseMarkdown(markdown));
  const doc = new DOMParser().parseFromString(clean, "text/html");
  doc.body.querySelectorAll("*").forEach(keepPermittedAttributes);
  doc.querySelectorAll("img[src]").forEach((image) => {
    if (options.imagesAsLinks === true) asLink(image);
    else unfetchedIfRemote(image, options.trustedImageOrigin);
  });
  doc.querySelectorAll("a[href]").forEach((link) => {
    link.setAttribute("target", "_blank");
    link.setAttribute("rel", "noopener noreferrer");
  });
  return doc.body.innerHTML;
}

/** The attributes a rendered reply may keep, PER ELEMENT. Every element not named here keeps none,
 *  and every attribute not listed beside its element is removed (#2115).
 *
 *  The problem this solves is not one tag. An `<img src>` fetches the moment it is in the document,
 *  and so do `srcset`, a `<source>` inside a `<picture>`, `<video poster>`, `<audio src>`,
 *  `<track src>`, `<input type="image" src>`, `style="background-image:url(…)"`, `<table background>`
 *  and — the ones that outlived a first, flat permitted-list — an SVG `<image href>` and an
 *  `<feImage href>`. MEASURED: all of those survive `marked` + DOMPurify's defaults, because raw
 *  HTML in a reply passes through both.
 *
 *  So the rule is not "remove the attributes that fetch" — that list is always one shape short of
 *  whatever gets written next, and it was twice already. It is "keep the handful that markdown prose
 *  needs, on the elements that need them". It fails closed: markdown that one day renders something
 *  new arrives plain until it is added here, rather than fetching quietly.
 *
 *  What each entry is for: `a` carries the link (which fetches only when a reader opens it), `img`
 *  the picture, `input` the task-list checkbox GFM emits, `th`/`td` the table alignment, `ol` a list
 *  that starts at something other than 1. `code`'s `class="language-ts"` is dropped deliberately —
 *  nothing here highlights, and `.md-prose pre code` styles by tag.
 *
 *  The rest is the code-block copy button (#2998): the wrapper's marker, the button's nonce and
 *  labels, and its icon's geometry. No `class` among them — the button is styled by attribute in
 *  src/style.css — so an author still cannot lay a decoy over a block. A forged button is inert: the
 *  click listener copies nothing without this document's nonce. */
const PERMITTED_ATTRIBUTES: Record<string, readonly string[]> = {
  A: ["href", "title"],
  IMG: ["src", "alt", "title"],
  INPUT: ["type", "checked", "disabled"],
  TH: ["align", "colspan", "rowspan"],
  TD: ["align", "colspan", "rowspan"],
  OL: ["start"],
  DIV: ["data-code-copy-block"],
  BUTTON: ["type", "data-code-copy", "data-code-copy-idle", "data-code-copy-copied", "aria-label", "title"],
  svg: ["viewbox", "fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "aria-hidden"],
  rect: ["x", "y", "width", "height", "rx"],
  path: ["d"],
};

function keepPermittedAttributes(element: Element): void {
  // `tagName` is upper-case for HTML and CASE-SENSITIVE for SVG (`feImage` stays `feImage`), which
  // is exactly where the flat list leaked: an SVG element simply is not in the table, so it keeps
  // nothing whatever it is called.
  const permitted = PERMITTED_ATTRIBUTES[element.tagName] ?? [];
  Array.from(element.attributes).forEach((attribute) => {
    if (!permitted.includes(attribute.name.toLowerCase())) element.removeAttribute(attribute.name);
  });
}

/** A REMOTE image becomes a link instead of an image (#2115).
 *
 *  An `<img>` fetches the moment it is in the document, so a reply carrying
 *  `![](https://somewhere/pixel.png)` tells that host the reader's address and the moment they
 *  opened the pane — and the reply is written by an agent that reads the web and other people's
 *  repositories, so its author need not be anyone here. Nothing is hidden: the URL becomes a link,
 *  which fetches when a reader decides to open it and not before. (The wiki does not have this
 *  shape — `renderWikiHtml` rewrites image sources onto MulmoTerminal's own raw-file route.)
 *
 *  `data:` and a relative path stay as images: neither leaves this origin. A `src` that will not
 *  parse is treated as remote, because the safe reading of "I cannot tell what this is" is not to
 *  fetch it. */
function unfetchedIfRemote(image: Element, trustedOrigin: string | undefined): void {
  const src = image.getAttribute("src") ?? "";
  if (!isRemoteUrl(src) || (trustedOrigin !== undefined && originOf(src) === trustedOrigin)) return;
  asLink(image);
}

function asLink(image: Element): void {
  const src = image.getAttribute("src") ?? "";
  const link = image.ownerDocument.createElement("a");
  link.setAttribute("href", src);
  link.textContent = image.getAttribute("alt")?.trim() || src;
  image.replaceWith(link);
}

const originOf = (src: string): string | null => {
  try {
    return new URL(src, window.location.href).origin;
  } catch {
    return null;
  }
};

const isRemoteUrl = (src: string): boolean => {
  if (src.startsWith("data:")) return false;
  try {
    // Relative sources resolve onto this origin and stay here; anything that resolves elsewhere is
    // a request to somebody else.
    return new URL(src, window.location.href).origin !== window.location.origin;
  } catch {
    return true;
  }
};
