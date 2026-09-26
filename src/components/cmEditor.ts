// Thin CodeMirror 6 wrapper for the Files view's editor: build/destroy an EditorView,
// swap the document + language when a different file is opened, and read it back on
// save. Kept out of the .vue file so the language-by-extension logic is unit-testable
// without a DOM.
import { EditorView, basicSetup } from "codemirror";
import { EditorState, Compartment, type Extension } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { oneDark } from "@codemirror/theme-one-dark";

export type LangKind = keyof typeof LANG_EXTENSIONS | "text";

// Which extensions each bundled mode claims. One table rather than a chain of ifs, so adding a
// language is one line and nothing can claim an extension twice (a spec checks that).
//
// `html` covers .vue / .svelte / .astro deliberately: a single-file component IS an HTML document
// with <script> and <style> in it, and CodeMirror's html mode already switches into JS and CSS
// inside those tags. A dedicated Vue mode would colour the template marginally better; this
// colours all three today, for one dependency.
const EXTENSIONS_BY_KIND = {
  markdown: ["md", "markdown", "mdx"],
  javascript: ["js", "jsx", "ts", "tsx", "mjs", "cjs"],
  json: ["json", "jsonc", "json5"],
  html: ["html", "htm", "vue", "svelte", "astro"],
  css: ["css", "scss", "less", "sass"],
  yaml: ["yaml", "yml"],
  xml: ["xml", "svg", "xsl", "plist"],
  python: ["py", "pyi", "pyw"],
  rust: ["rs"],
  go: ["go"],
  java: ["java", "kt", "kts"],
  cpp: ["c", "h", "cc", "cpp", "cxx", "hpp", "hh", "m", "mm"],
  php: ["php"],
  sql: ["sql"],
} as const;

// `Object.entries` widens the table's keys back to `string`; this carries them back into the type
// without asserting, so a kind added to the table above is picked up here with no second list.
const isLangKind = (kind: string): kind is LangKind => Object.prototype.hasOwnProperty.call(EXTENSIONS_BY_KIND, kind);

// Pick a syntax mode from a filename's extension. Only the modes we bundle are
// recognised; everything else edits as plain text.
export function langKindForFilename(name: string): LangKind {
  const dot = name.lastIndexOf(".");
  if (dot < 0) return "text"; // no extension (Makefile, LICENSE, …)
  const ext = name.slice(dot + 1).toLowerCase();
  // Over the table's own keys rather than Object.entries, which widens them back to `string` —
  // the two assertions this replaces were both undoing that widening.
  for (const [kind, exts] of Object.entries(EXTENSIONS_BY_KIND)) {
    if (exts.some((candidate: string) => candidate === ext) && isLangKind(kind)) return kind;
  }
  return "text";
}

// How each mode is obtained. The three that were here first stay bundled — markdown, JS/TS and
// JSON are what this app's own files are — while the rest are fetched when a file of that kind is
// first opened.
//
// Dynamic import is the exception the repo's rules allow ("conditional/optional dependencies that
// are not always loaded"), and it applies here: bundling all eleven cost 462 kB raw / 163 kB gzip
// on every page load, paid by everyone, for grammars most sessions never touch. Swapping the mode
// in later is free — the language already lives in a Compartment so it can be reconfigured.
const LANG_EXTENSIONS = {
  markdown: () => markdown(),
  javascript: () => javascript({ typescript: true }),
  json: () => json(),
  html: () => import("@codemirror/lang-html").then((m) => m.html()),
  css: () => import("@codemirror/lang-css").then((m) => m.css()),
  yaml: () => import("@codemirror/lang-yaml").then((m) => m.yaml()),
  xml: () => import("@codemirror/lang-xml").then((m) => m.xml()),
  python: () => import("@codemirror/lang-python").then((m) => m.python()),
  rust: () => import("@codemirror/lang-rust").then((m) => m.rust()),
  go: () => import("@codemirror/lang-go").then((m) => m.go()),
  java: () => import("@codemirror/lang-java").then((m) => m.java()),
  cpp: () => import("@codemirror/lang-cpp").then((m) => m.cpp()),
  php: () => import("@codemirror/lang-php").then((m) => m.php()),
  sql: () => import("@codemirror/lang-sql").then((m) => m.sql()),
} satisfies Record<keyof typeof EXTENSIONS_BY_KIND, () => Extension | Promise<Extension>>;

/** Exported for the spec: which modes cost a round trip is a decision worth pinning. */
export function langExtensionForKind(kind: LangKind): Extension | Promise<Extension> {
  return kind === "text" ? [] : LANG_EXTENSIONS[kind]();
}

/** Where the reader was, as a place in the FILE rather than a pixel offset. A line survives a
 *  different window width, a different font size and a wrapped paragraph; a `scrollTop` survives
 *  none of them, and the file is often reopened in a pane of another size (#2149). */
export interface CaretAt {
  line: number;
  col: number;
}

export interface CmEditor {
  setDoc(text: string, filename: string): void;
  getDoc(): string;
  /** Null for an empty document — there is no place to come back to. */
  caretAt(): CaretAt | null;
  /** Put the caret back and bring it into view. A line past the end of what is there NOW is
   *  clamped rather than ignored: the file may have been edited since, and the nearest real line is
   *  closer to where the reader was than the top of the file is. Does NOT take focus — a restored
   *  pane must not pull the keyboard out of wherever the user is. */
  goTo(at: CaretAt): void;
  /** The line at the TOP of what the reader can see, or null for an empty document. The caret is
   *  not it: scrolling moves neither the selection nor `caretAt()`, so a reader who never clicks
   *  has a caret on line 1 while reading line 130 — and restoring only the caret puts them back at
   *  the top of a file they were in the middle of (#2149, found by driving a browser). */
  topLine(): number | null;
  /** Put `line` (1-based) at the top of the viewport, without moving the caret. Restoring a place
   *  is two things: where the cursor was, and what was on screen. */
  scrollLineToTop(line: number): void;
  /** Put the cursor on `line` (1-based), scroll it into view, and TAKE FOCUS. Without this, opening
   *  a search result shows the top of the file and the reader has to find the match again by hand
   *  (#2140). The focus is the whole difference from `goTo`: a result was clicked, so the reader
   *  means to be in the file. */
  revealLine(line: number): void;
  destroy(): void;
}

/** Everything about WHERE — where the cursor is, what is on screen, and how to put either back.
 *  Separate from `createEditor` because it is the half a pane restores, and because the two
 *  together are more than one function's worth of editor. */
function placeApi(view: EditorView): Pick<CmEditor, "caretAt" | "goTo" | "topLine" | "scrollLineToTop" | "revealLine"> {
  // CLAMPED to the document rather than trusted, and TRUNCATED before anything is looked up. Both
  // callers can be wrong in their own way: a search line came from the file ON DISK and the buffer
  // may already be shorter (the agent in this directory rewrites files while the panel is open),
  // and a remembered caret comes out of localStorage, where a fractional value is not refused by
  // CodeMirror — it lands on a fractional offset and reads back as a fractional column, which is
  // then what gets remembered. Out of range, CodeMirror throws, and for the search that took the
  // click with it and looked like a dead result (#2140, #2156).
  //
  // Truncated rather than rounded because `revealLine` did that before these two became one
  // function, and a merge is no place to change what somebody else's caller observes. Nothing
  // reaches here with a fraction on purpose — the store rejects a non-integer caret outright — so
  // the choice is only about which arbitrary answer a corrupt value gets.
  const goTo = (at: CaretAt): void => {
    const line = view.state.doc.line(Math.min(Math.max(Math.trunc(at.line), 1), view.state.doc.lines));
    const head = Math.min(line.from + Math.max(Math.trunc(at.col), 0), line.to);
    view.dispatch({ selection: { anchor: head }, effects: EditorView.scrollIntoView(head, { y: "center" }) });
  };

  return {
    caretAt() {
      if (view.state.doc.length === 0) return null;
      const line = view.state.doc.lineAt(view.state.selection.main.head);
      return { line: line.number, col: view.state.selection.main.head - line.from };
    },
    goTo,
    topLine() {
      if (view.state.doc.length === 0) return null;
      // Measured from the SCROLLER rather than from the selection: what a reader is looking at is a
      // geometric fact, and CodeMirror only renders the lines near the viewport.
      const block = view.lineBlockAtHeight(view.scrollDOM.scrollTop);
      return view.state.doc.lineAt(block.from).number;
    },
    scrollLineToTop(line) {
      const target = view.state.doc.line(Math.min(Math.max(Math.trunc(line), 1), view.state.doc.lines));
      view.dispatch({ effects: EditorView.scrollIntoView(target.from, { y: "start" }) });
    },
    revealLine(line) {
      goTo({ line, col: 0 });
      view.focus();
    },
  };
}

// `onChange` fires only on USER edits. Loading a file replaces the whole EditorState rather than
// dispatching into it, so the load is neither a change the listener sees nor a step Undo can take
// back — undoing one emptied the buffer, marked it dirty, and the pane saved that on leaving (#2258).
export function createEditor(parent: HTMLElement, onChange: () => void): CmEditor {
  const lang = new Compartment();
  const stateFor = (doc: string, mode: Extension): EditorState =>
    EditorState.create({
      doc,
      extensions: [
        basicSetup,
        oneDark,
        lang.of(mode),
        EditorView.lineWrapping,
        EditorView.updateListener.of((u) => {
          if (u.docChanged) onChange();
        }),
      ],
    });
  const view = new EditorView({ parent, state: stateFor("", []) });
  // Which file the editor is showing NOW. A lazily-imported grammar can land after the user has
  // already opened something else, and applying it then would colour the new file as the old
  // one's language — the same staleness guard the fetch-per-cwd code uses.
  let docSeq = 0;

  return {
    setDoc(text, filename) {
      const seq = ++docSeq;
      const mode = langExtensionForKind(langKindForFilename(filename));
      // A bundled mode is applied with the text. A lazy one starts as no highlighting and arrives
      // below — the file is readable either way, it just goes from plain to coloured.
      view.setState(stateFor(text, mode instanceof Promise ? [] : mode));
      if (mode instanceof Promise) {
        void mode
          .then((extension) => {
            if (seq === docSeq) view.dispatch({ effects: lang.reconfigure(extension) });
          })
          .catch(() => {
            // A grammar that fails to load leaves the file as plain text, which is what it was
            // before this existed. Nothing to report to the user.
          });
      }
    },
    getDoc: () => view.state.doc.toString(),
    ...placeApi(view),
    destroy: () => view.destroy(),
  };
}
