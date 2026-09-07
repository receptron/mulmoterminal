// Which files the Canvas can be asked to open, and what card is written for them (#1374).
//
// The gates are the PLUGINS' own (`isDocumentPath`, `isPresentableHtmlPath`), so what is pinned
// here is that this module actually defers to them rather than re-deciding with a weaker extension
// test — the traversal and dotfile cases below are the ones a hand-rolled `.endsWith(".md")` would
// wave through.
import { describe, it, expect, vi, afterEach } from "vitest";

import {
  canvasCardForFile,
  canOpenInCanvas,
  absoluteUnder,
  storyWirePath,
  buildCanvasCard,
  seedCanvasCard,
  hasStoredCard,
} from "../../../src/composables/canvasOpenFile";

describe("canvasCardForFile", () => {
  it("renders a markdown document through presentDocument, keyed by its path", () => {
    expect(canvasCardForFile("docs/design.md")).toEqual({
      toolName: "presentDocument",
      // `markdown: ""` is required by MarkdownToolData; `docPath` is what documentPathOf reads.
      data: { markdown: "", docPath: "docs/design.md" },
    });
  });

  it("takes a markdown file from anywhere in the workspace, not only the artifacts area", () => {
    expect(canvasCardForFile("README.md")?.toolName).toBe("presentDocument");
  });

  // Inside artifacts the View could derive this URL itself; it is set anyway so the card does not
  // depend on a fallback that only holds for one of the two locations.
  it("points an artifacts page at the artifacts mount", () => {
    expect(canvasCardForFile("artifacts/html/page.html")).toEqual({
      toolName: "presentHtml",
      data: { filePath: "artifacts/html/page.html", previewUrl: "/artifacts/html/page.html" },
    });
  });

  // The case the View's fallback gets WRONG. The Files pane is rooted at the cell's cwd, so most
  // html a user opens is outside artifacts; deriving `/artifacts/html/…` for it would point the
  // iframe at nothing.
  it("points a page outside artifacts at the /htmlfile mount instead", () => {
    expect(canvasCardForFile("site/index.html")).toEqual({
      toolName: "presentHtml",
      data: { filePath: "site/index.html", previewUrl: "/htmlfile/ws/site/index.html" },
    });
  });

  it("has nothing to show for a file neither plugin renders", () => {
    expect(canvasCardForFile("notes.txt")).toBeNull();
    expect(canvasCardForFile("src/main.ts")).toBeNull();
  });

  // Both of these END in a renderable extension, so an extension test would accept them. The
  // plugins refuse them — a prefixed traversal, and a dotfile segment the iframe mount denies.
  it("refuses a path the plugin's own guard refuses", () => {
    expect(canvasCardForFile("artifacts/documents/../../secrets.md")).toBeNull();
    expect(canvasCardForFile(".hidden/x.html")).toBeNull();
  });
});

describe("canOpenInCanvas", () => {
  it("answers for the button's sake, and says no when nothing is open", () => {
    expect(canOpenInCanvas("docs/design.md")).toBe(true);
    expect(canOpenInCanvas("site/index.html")).toBe(true);
    expect(canOpenInCanvas("notes.txt")).toBe(false);
    expect(canOpenInCanvas(null)).toBe(false);
  });
});

// The bug the browser found: the Files pane is rooted at the CELL's directory while the plugins
// resolve against the WORKSPACE, so a bare `design.md` from a project cell named a workspace file
// that does not exist — the card was written, the pane opened, and nothing rendered.
describe("absoluteUnder", () => {
  it("puts the pane's relative row under the cell's directory", () => {
    expect(absoluteUnder("/work/proj", "docs/design.md")).toBe("/work/proj/docs/design.md");
  });

  it("does not double the separator", () => {
    expect(absoluteUnder("/work/proj/", "design.md")).toBe("/work/proj/design.md");
  });

  // Joined with `/` on every platform. Both plugin gates accept the mixed result and htmlFileUrl
  // normalises it, so there is no separator arithmetic to get wrong per-OS.
  it("leaves a Windows directory alone and still produces a path the gates accept", () => {
    const joined = absoluteUnder("C:\\Users\\me\\proj", "docs/design.md");
    expect(joined).toBe("C:\\Users\\me\\proj/docs/design.md");
    expect(canvasCardForFile(joined)?.toolName).toBe("presentDocument");
  });

  it("passes the path through when there is no cwd to anchor it to", () => {
    expect(absoluteUnder(null, "design.md")).toBe("design.md");
  });
});

// The disagreement the pane's button could have with the card builder: the row's own path passes,
// and the one the card would carry does not. A cell working under a dot directory is the ordinary
// way to reach it (`~/.config/…`), and the symptom is a button that does nothing when pressed.
describe("the button's gate and the card's gate agree on the same path", () => {
  it("refuses an html file whose containing directory the plugin's guard rejects", () => {
    expect(canOpenInCanvas("p.html")).toBe(true); // the row alone looks fine
    const joined = absoluteUnder("/home/me/.config/proj", "p.html");
    expect(canOpenInCanvas(joined)).toBe(false); // …and the card's path does not
    expect(canvasCardForFile(joined)).toBeNull();
  });

  it("still accepts an ordinary directory", () => {
    const joined = absoluteUnder("/home/me/proj", "p.html");
    expect(canOpenInCanvas(joined)).toBe(true);
    expect(canvasCardForFile(joined)?.toolName).toBe("presentHtml");
  });
});

// mulmoScript, the one tool here that cannot be handed an absolute path — `normalizeStoryPath`
// refuses those outright. So the question is not "does the extension match" but "is this file in
// the WORKSPACE's story directory", and the answer is the wire path the plugin wants.
// A deck kept beside the notes it was written from (#1933). The workspace subtree is registered
// with the plugin under an id the server mints, and a story anywhere under it is addressable as
// `(root, stories/<rel>)` — which is what makes "put the deck in the repository" work at all.
describe("storyWirePath — the workspace subtree", () => {
  const WS = "/work/ws";
  const ROOTS = { workspaces: [WS], roots: [{ id: "abc123", paths: [WS] }] };

  it("names a deck kept anywhere under the workspace", () => {
    expect(storyWirePath(`${WS}/myrepo/decks/talk.json`, ROOTS)).toEqual({ filePath: "stories/myrepo/decks/talk.json", root: "abc123" });
  });

  // The workspace's own stories directory sits INSIDE the subtree, so both could name one file —
  // as `stories/x.json` and as `stories/artifacts/stories/x.json`. Two spellings are two card
  // identities, i.e. two cards for one deck, so the narrower one is decided first and wins.
  it("keeps the default root's spelling for a file in the workspace's own stories directory", () => {
    expect(storyWirePath(`${WS}/artifacts/stories/tale.json`, ROOTS)).toEqual({ filePath: "stories/tale.json" });
  });

  // Without the id the subtree has no ROOT-RELATIVE spelling — and since #1976 that is no longer
  // the end of it: the deck is addressed by its own absolute path, which is the form the plugin
  // takes for a file outside every root. The card is the same card either way (canvasCardPath.ts
  // resolves both to this path), which is what made offering it safe.
  it("falls back to the absolute path when the subtree has no id", () => {
    expect(storyWirePath(`${WS}/myrepo/decks/talk.json`, { workspaces: [WS], roots: [] })).toEqual({ filePath: `${WS}/myrepo/decks/talk.json` });
  });

  // A workspace that IS a root directory: `dirPathKey` answers `/`, `C:/` or `//server/share`, and
  // the first two already carry the separator. Joining another one made `//artifacts/stories` —
  // read back as a UNC share root — so nothing under such a workspace was a story at all
  // (Codex P1 on #1934). The default-root half of that predates the named root.
  it("recognises a workspace that is a filesystem root", () => {
    expect(storyWirePath("/myrepo/decks/talk.json", { workspaces: ["/"], roots: [{ id: "abc123", paths: ["/"] }] })).toEqual({
      filePath: "stories/myrepo/decks/talk.json",
      root: "abc123",
    });
    expect(storyWirePath("/artifacts/stories/x.json", { workspaces: ["/"], roots: [{ id: "abc123", paths: ["/"] }] })).toEqual({ filePath: "stories/x.json" });
  });

  // `dirPathKey` TRIMS, so a directory whose last component ends in a space lost it the moment the
  // workspace was keyed on its own — and then nothing under it matched, the workspace's own stories
  // directory included (Codex P2 on #1934, a regression this PR introduced). Both roots are pinned
  // because one rule now answers for both.
  it("recognises a workspace whose last component ends in a space", () => {
    const WS_SPACE = "/work/ws ";
    expect(storyWirePath("/work/ws /myrepo/deck.json", { workspaces: [WS_SPACE], roots: [{ id: "abc123", paths: [WS_SPACE] }] })).toEqual({
      filePath: "stories/myrepo/deck.json",
      root: "abc123",
    });
    expect(storyWirePath("/work/ws /artifacts/stories/x.json", { workspaces: [WS_SPACE], roots: [{ id: "abc123", paths: [WS_SPACE] }] })).toEqual({
      filePath: "stories/x.json",
    });
  });

  it("recognises a Windows drive root and a UNC share root", () => {
    expect(storyWirePath("C:\\myrepo\\decks\\talk.json", { workspaces: ["C:\\"], roots: [{ id: "abc123", paths: ["C:\\"] }] })).toEqual({
      filePath: "stories/myrepo/decks/talk.json",
      root: "abc123",
    });
    expect(storyWirePath("//server/share/myrepo/talk.json", { workspaces: ["//server/share"], roots: [{ id: "abc123", paths: ["//server/share"] }] })).toEqual({
      filePath: "stories/myrepo/talk.json",
      root: "abc123",
    });
  });

  // Launched through a symlink, the Files pane can hand either spelling: a cell from the launcher
  // carries the one the user typed, one in a git worktree carries the resolved one. Knowing only
  // the canonical spelling hid the Canvas entry for every deck under the link (Codex P1 iter-5).
  it("recognises a file under either spelling of the workspace", () => {
    const BOTH = { workspaces: ["/tmp/ws-link", "/srv/real-ws"], roots: [{ id: "abc123", paths: ["/tmp/ws-link", "/srv/real-ws"] }] };
    expect(storyWirePath("/tmp/ws-link/decks/talk.json", BOTH)).toEqual({ filePath: "stories/decks/talk.json", root: "abc123" });
    expect(storyWirePath("/srv/real-ws/decks/talk.json", BOTH)).toEqual({ filePath: "stories/decks/talk.json", root: "abc123" });
    // The default root too — it is the half that worked before the named root existed.
    expect(storyWirePath("/tmp/ws-link/artifacts/stories/x.json", BOTH)).toEqual({ filePath: "stories/x.json" });
    expect(storyWirePath("/srv/real-ws/artifacts/stories/x.json", BOTH)).toEqual({ filePath: "stories/x.json" });
  });

  // The BOUNDARY still decides the spelling — a deck outside the workspace does not borrow its
  // root — but it no longer decides whether the deck can be opened at all (#1976).
  it("names a deck outside the workspace by its absolute path, with no root", () => {
    expect(storyWirePath("/work/elsewhere/deck.json", ROOTS)).toEqual({ filePath: "/work/elsewhere/deck.json" });
  });

  it("takes only .json, here too", () => {
    expect(storyWirePath(`${WS}/myrepo/notes.md`, ROOTS)).toBeNull();
  });

  it("is what canOpenInCanvas answers on", () => {
    expect(canOpenInCanvas(`${WS}/myrepo/decks/talk.json`, ROOTS)).toBe(true);
    // …and the entry is offered without the id too, on the absolute form (#1976).
    expect(canOpenInCanvas(`${WS}/myrepo/decks/talk.json`, { workspaces: [WS], roots: [] })).toBe(true);
  });
});

describe("storyWirePath", () => {
  const WS = "/work/ws";

  it("turns a story under the workspace into the plugin's wire path", () => {
    expect(storyWirePath(`${WS}/artifacts/stories/tale.json`, { workspaces: [WS], roots: [] })).toEqual({ filePath: "stories/tale.json" });
  });

  it("keeps a story's own subdirectory", () => {
    expect(storyWirePath(`${WS}/artifacts/stories/drafts/tale.json`, { workspaces: [WS], roots: [] })).toEqual({ filePath: "stories/drafts/tale.json" });
  });

  // The reason the root-relative form is rooted at the workspace rather than matched on shape: a
  // project cell may have an artifacts/stories of its own, and `stories/tale.json` would open the
  // WORKSPACE's file of that name instead. It gets the absolute form, which names the file it is.
  it("does not give an identically-shaped path under another directory the workspace's spelling", () => {
    expect(storyWirePath("/work/other/artifacts/stories/tale.json", { workspaces: [WS], roots: [] })).toEqual({
      filePath: "/work/other/artifacts/stories/tale.json",
    });
  });

  it("refuses a file in the story directory that is not a script", () => {
    expect(storyWirePath(`${WS}/artifacts/stories/notes.md`, { workspaces: [WS], roots: [] })).toBeNull();
    expect(storyWirePath(`${WS}/artifacts/stories/tale.json.bak`, { workspaces: [WS], roots: [] })).toBeNull();
  });

  // `..` folds away in the key, so a traversal stops matching the prefix rather than being
  // spotted as a traversal — the same reason the workspace chip can compare paths at all. It never
  // gets the stories root's spelling, which is the part that mattered: `stories/secrets.json` would
  // have named a file INSIDE the root. What it gets now is itself, unfolded — and the plugin
  // refuses a `.`/`..` segment in an absolute path, so the open ends in a sentence rather than a
  // surprise. Nothing in the tree produces such a row; this pins the shape, not a workflow.
  it("never gives a path that climbs out of the story directory the root's spelling", () => {
    expect(storyWirePath(`${WS}/artifacts/stories/../../../etc/passwd`, { workspaces: [WS], roots: [] })).toBeNull();
    expect(storyWirePath(`${WS}/artifacts/stories/../secrets.json`, { workspaces: [WS], roots: [] })).toEqual({
      filePath: `${WS}/artifacts/stories/../secrets.json`,
    });
  });

  it("refuses the story directory itself, which is not a file", () => {
    expect(storyWirePath(`${WS}/artifacts/stories`, { workspaces: [WS], roots: [] })).toBeNull();
  });

  // Before the config lands there is no root to be relative TO, so the absolute form answers — and
  // it resolves to the same identity the root-relative card gets afterwards, so the two collapse
  // rather than doubling.
  it("uses the absolute form before the config lands", () => {
    expect(storyWirePath(`${WS}/artifacts/stories/tale.json`, { workspaces: [], roots: [] })).toEqual({ filePath: `${WS}/artifacts/stories/tale.json` });
  });

  // Both separators fold, so the mixed path `absoluteUnder` produces on Windows still matches.
  it("matches a Windows workspace against a mixed-separator path", () => {
    const joined = absoluteUnder("C:\\Users\\me\\ws", "artifacts/stories/tale.json");
    expect(storyWirePath(joined, { workspaces: ["C:\\Users\\me\\ws"], roots: [] })).toEqual({ filePath: "stories/tale.json" });
  });

  it("is what canOpenInCanvas answers on for a story", () => {
    expect(canOpenInCanvas(`${WS}/artifacts/stories/tale.json`, { workspaces: [WS], roots: [] })).toBe(true);
    // A story is offered wherever it lives now, like markdown and html always were (#1976) — but
    // only when the pane could say WHERE it is: a bare row with no cwd behind it still cannot.
    expect(canOpenInCanvas(`${WS}/artifacts/stories/tale.json`, { workspaces: [], roots: [] })).toBe(true);
    expect(canOpenInCanvas("tale.json", { workspaces: [], roots: [] })).toBe(false);
    expect(canOpenInCanvas(`${WS}/notes.md`, { workspaces: [], roots: [] })).toBe(true);
  });
});

// #1976: a deck that lives outside every registered stories root. The plugin has taken an absolute
// `filePath` since 4.6.0 and this host opts into it (`byPath`), so the file always opened when the
// AGENT asked for it — the Files pane simply never offered the entry, because one deck reached two
// ways would have become two cards. Identity is the resolved path now, so it is one card either way
// and the entry can be offered.
describe("storyWirePath — a deck outside every root", () => {
  const WS = "/work/ws";
  const ROOTS = { workspaces: [WS], roots: [{ id: "abc123", paths: [WS] }] };

  // The issue's own example: a deck in a directory the user never launched in.
  it("names it by its absolute path, with no root", () => {
    expect(storyWirePath("/Users/me/decks/keynote.json", ROOTS)).toEqual({ filePath: "/Users/me/decks/keynote.json" });
  });

  it("offers the Canvas entry for it", () => {
    expect(canOpenInCanvas("/Users/me/decks/keynote.json", ROOTS)).toBe(true);
  });

  it("still takes only .json", () => {
    expect(storyWirePath("/Users/me/decks/notes.md", ROOTS)).toBeNull();
    expect(storyWirePath("/Users/me/decks/keynote.json.bak", ROOTS)).toBeNull();
  });

  // The pane joins the row onto the cell's cwd, and falls back to the ROW ALONE when it has no cwd
  // (`absoluteUnder`). A relative `filePath` is not "the file over there" — the plugin reads it
  // against the default stories root, i.e. a different file that may well exist.
  it("refuses a path that is not rooted, because it names no file", () => {
    expect(storyWirePath("decks/keynote.json", ROOTS)).toBeNull();
    expect(storyWirePath("keynote.json", ROOTS)).toBeNull();
    expect(canOpenInCanvas("decks/keynote.json", ROOTS)).toBe(false);
  });

  // Rooted on the process's current DRIVE, which the spelling does not carry (Codex P2 on the
  // identity half). Nothing here can say which file that is.
  it("refuses a Windows path whose drive is unknown", () => {
    expect(storyWirePath("\\decks\\keynote.json", ROOTS)).toBeNull();
    expect(storyWirePath("C:\\decks\\keynote.json", ROOTS)).toEqual({ filePath: "C:\\decks\\keynote.json" });
  });

  // The root-relative form still wins where there is one: it is the shorter, readable spelling, and
  // it keeps the root a card names true.
  it("prefers the root-relative spelling where the file has one", () => {
    expect(storyWirePath(`${WS}/decks/keynote.json`, ROOTS)).toEqual({ filePath: "stories/decks/keynote.json", root: "abc123" });
    expect(storyWirePath(`${WS}/artifacts/stories/keynote.json`, ROOTS)).toEqual({ filePath: "stories/keynote.json" });
  });
});

// The card for a story comes from the plugin's own reopen: `MulmoScriptData` needs the parsed
// script, and reading it here would be a second copy of what that route already does.
describe("buildCanvasCard", () => {
  const WS = "/work/ws";
  afterEach(() => vi.unstubAllGlobals());

  const mockReopen = (body: unknown, ok = true) => {
    const fetchMock = vi.fn(async () => ({ ok, json: async () => body }) as Response);
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  };

  it("builds a markdown card without asking the server anything", async () => {
    const fetchMock = mockReopen({});
    expect(await buildCanvasCard(`${WS}/docs/design.md`, { workspaces: [WS], roots: [] })).toEqual({
      kind: "card",
      card: { toolName: "presentDocument", data: { markdown: "", docPath: `${WS}/docs/design.md` } },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // The DISPATCH shape, flat: `{ok, script, filePath, root}`. The kind-less body answers an
  // envelope `{data}` instead, and reading that one here built no card at all — the row's menu
  // entry appeared and clicking it did nothing, which only a browser run showed (#1933).
  it("reopens a story through the plugin route and carries back what it returned", async () => {
    const fetchMock = mockReopen({ ok: true, script: { title: "Tale" }, filePath: "stories/tale.json", message: "Reopened" });
    expect(await buildCanvasCard(`${WS}/artifacts/stories/tale.json`, { workspaces: [WS], roots: [] })).toEqual({
      kind: "card",
      card: { toolName: "presentMulmoScript", data: { script: { title: "Tale" }, filePath: "stories/tale.json" } },
    });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/plugin/presentMulmoScript");
    // `kind: "save"` — the reopen the DISPATCH serves, which is the only shape that carries a root.
    // The kind-less body is the agent's tool call and is deliberately root-blind.
    // `expectPath` is the absolute path the pane showed: the server compares it with what the wire
    // path resolves to, because the browser's own check is lexical and cannot see a moved workspace.
    expect(JSON.parse(String(init.body))).toEqual({ kind: "save", filePath: "stories/tale.json", expectPath: `${WS}/artifacts/stories/tale.json` });
  });

  // #1976, the whole point of the gate change: a deck outside every root reaches the same reopen,
  // by its own absolute path. `expectPath` is that same string — the server compares its realpath
  // with the one the wire path resolved to, which for this form is trivially the same file, and the
  // check stays meaningful for the root-relative forms above.
  it("reopens a deck outside every root by absolute path", async () => {
    const fetchMock = mockReopen({ ok: true, script: { title: "Keynote" }, filePath: "/Users/me/decks/keynote.json" });
    expect(await buildCanvasCard("/Users/me/decks/keynote.json", { workspaces: [WS], roots: [{ id: "abc123", paths: [WS] }] })).toEqual({
      kind: "card",
      card: { toolName: "presentMulmoScript", data: { script: { title: "Keynote" }, filePath: "/Users/me/decks/keynote.json" } },
    });
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({
      kind: "save",
      filePath: "/Users/me/decks/keynote.json",
      expectPath: "/Users/me/decks/keynote.json",
    });
  });

  // What the pane shows when the file is a `.json` that is not a deck — every repository has one,
  // and the entry is offered on the extension alone. The plugin's sentence is what the user sees;
  // silence here is the dead button #1941 removed.
  it("carries back the plugin's sentence for a .json that is not a deck", async () => {
    mockReopen({ ok: false, code: "bad_request", error: "File is not a valid MulmoScript" });
    expect(await buildCanvasCard("/Users/me/proj/package.json", { workspaces: [WS], roots: [] })).toEqual({
      kind: "refused",
      reason: "File is not a valid MulmoScript",
    });
  });

  // The root travels on the card, because that is what keeps two roots' identically-named decks on
  // two cards (canvasIdentity.filePathIdentity) rather than folding them into one.
  it("carries the root onto the card, and asks for it by name", async () => {
    const fetchMock = mockReopen({ ok: true, script: { title: "Deck" }, filePath: "stories/myrepo/decks/talk.json", root: "abc123" });
    expect(await buildCanvasCard(`${WS}/myrepo/decks/talk.json`, { workspaces: [WS], roots: [{ id: "abc123", paths: [WS] }] })).toEqual({
      kind: "card",
      card: { toolName: "presentMulmoScript", data: { script: { title: "Deck" }, filePath: "stories/myrepo/decks/talk.json", root: "abc123" } },
    });
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({
      kind: "save",
      filePath: "stories/myrepo/decks/talk.json",
      root: "abc123",
      expectPath: `${WS}/myrepo/decks/talk.json`,
    });
  });

  // The server's sentence has to reach the caller: collapsing it into "no card" is what made a
  // refused open look like a dead button (#1941).
  it("carries the reason back when the dispatch refuses", async () => {
    mockReopen({ ok: false, code: "bad_request", error: 'unknown stories root "gone"' });
    expect(await buildCanvasCard(`${WS}/myrepo/decks/talk.json`, { workspaces: [WS], roots: [{ id: "gone", paths: [WS] }] })).toEqual({
      kind: "refused",
      reason: 'unknown stories root "gone"',
    });
  });

  it("carries the reason back when the server refuses with a status", async () => {
    mockReopen({ ok: false, code: "bad_request", error: "that deck is not the file this server serves under that path" }, false);
    expect(await buildCanvasCard(`${WS}/myrepo/decks/talk.json`, { workspaces: [WS], roots: [{ id: "abc123", paths: [WS] }] })).toEqual({
      kind: "refused",
      reason: "that deck is not the file this server serves under that path",
    });
  });

  // The shape a MISSING story really comes back as, measured against the running server: HTTP 200
  // with `ok:false` and a sentence. The file can vanish between the menu opening and the click, so
  // this is the common race — and it must not be the silent no-op this PR exists to remove.
  it("carries the reason back when the story is gone", async () => {
    mockReopen({ ok: false, code: "not_found", error: "File not found: stories/gone.json" });
    expect(await buildCanvasCard(`${WS}/artifacts/stories/gone.json`, { workspaces: [WS], roots: [] })).toEqual({
      kind: "refused",
      reason: "File not found: stories/gone.json",
    });
  });

  // Reaching the reopen means the action was OFFERED and clicked. Nothing from here may be silent,
  // whatever came back — an empty body, a proxy's error page, a shape nobody recognises.
  it("says something even when the response carries no reason", async () => {
    mockReopen({}, false);
    expect(await buildCanvasCard(`${WS}/artifacts/stories/tale.json`, { workspaces: [WS], roots: [] })).toEqual({
      kind: "refused",
      reason: "could not open this deck — the server did not say why",
    });
  });

  // A blank `error` is the same nothing as a missing one, and `??` does not catch it: it would
  // reach `showError`, which the pane renders under `v-if` — so the click would look ignored, the
  // exact failure this change removes (CodeRabbit on #1942).
  it("says something when the reason is blank", async () => {
    mockReopen({ ok: false, code: "bad_request", error: "   " }, false);
    expect(await buildCanvasCard(`${WS}/artifacts/stories/tale.json`, { workspaces: [WS], roots: [] })).toEqual({
      kind: "refused",
      reason: "could not open this deck — the server did not say why",
    });
  });

  it("says something when the body is not JSON at all", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          ({
            ok: true,
            json: async () => {
              throw new Error("not json");
            },
          }) as unknown as Response,
      ),
    );
    expect(await buildCanvasCard(`${WS}/artifacts/stories/tale.json`, { workspaces: [WS], roots: [] })).toEqual({
      kind: "refused",
      reason: "could not open this deck — the server did not say why",
    });
  });

  it("does not reach the server for a file no plugin renders", async () => {
    const fetchMock = mockReopen({});
    // Silent by design: nothing offers the action for such a file, so it cannot be clicked.
    expect(await buildCanvasCard(`${WS}/notes.txt`, { workspaces: [WS], roots: [] })).toEqual({ kind: "none" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// The ordering inside buildCanvasCard is load-bearing and silent: markdown and html are asked
// first, so if either ever started accepting `.json`, every story in the workspace would quietly
// open as that other thing instead. Pinned against the plugins themselves, not against our own
// reasoning about them — a package upgrade is exactly how this would change.
describe("the three plugins do not claim each other's files", () => {
  const WS = "/work/ws";

  it("leaves a story's .json to the story branch", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, script: {}, filePath: "stories/tale.json" }) }) as Response);
    vi.stubGlobal("fetch", fetchMock);
    expect(canvasCardForFile(`${WS}/artifacts/stories/tale.json`)).toBeNull(); // no other plugin takes it
    const built = await buildCanvasCard(`${WS}/artifacts/stories/tale.json`, { workspaces: [WS], roots: [] });
    expect(built.kind === "card" && built.card.toolName).toBe("presentMulmoScript");
    vi.unstubAllGlobals();
  });

  // The converse: a document that happens to live in the story directory is a document. It is not
  // a story, and storyWirePath's `.json` requirement is what keeps it from being treated as one.
  it("leaves a document in the story directory to the markdown branch", async () => {
    expect(storyWirePath(`${WS}/artifacts/stories/notes.md`, { workspaces: [WS], roots: [] })).toBeNull();
    expect(canvasCardForFile(`${WS}/artifacts/stories/notes.md`)?.toolName).toBe("presentDocument");
  });
});

// Bounded like the repo's other API callers. The reopen blocks the Canvas from opening, so a
// server that never answers would otherwise leave the button pressed and nothing happening.
describe("a request that never answers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  const hangUntilAborted = () => {
    const started: AbortSignal[] = [];
    vi.stubGlobal("fetch", (_url: string, init?: RequestInit) => {
      const signal = init?.signal;
      if (signal) started.push(signal);
      return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      });
    });
    return started;
  };

  it("gives up on the reopen instead of hanging forever", async () => {
    vi.useFakeTimers();
    const started = hangUntilAborted();
    const pending = buildCanvasCard("/work/ws/artifacts/stories/tale.json", { workspaces: ["/work/ws"], roots: [] });
    await vi.advanceTimersByTimeAsync(10_000);
    // A timeout is a refusal with something to say, not a silent "nothing renders this": the user
    // clicked and deserves to know the request never landed (#1941).
    expect(await pending).toEqual({ kind: "refused", reason: "could not reach this server to open the deck" });
    expect(started[0]?.aborted).toBe(true);
  });

  it("gives up on the seed, so the Canvas is not revealed over a card that never landed", async () => {
    vi.useFakeTimers();
    hangUntilAborted();
    const pending = seedCanvasCard("s-1", { toolName: "presentDocument", data: {} });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await pending).toBe(false);
  });

  it("gives up on the stored-card check, answering no", async () => {
    vi.useFakeTimers();
    hangUntilAborted();
    const pending = hasStoredCard("s-1");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await pending).toBe(false);
  });
});

// Many roots since #1951 — the workspace plus every directory the user launches in. The browser
// decides which one a path belongs to before asking the server for anything, so the choice has to
// be deterministic and independent of the order the server listed them in.
describe("storyWirePath across several roots", () => {
  const WS_ROOT = { id: "ws-id", paths: ["/work/ws"] };
  const OTHER = { id: "other-id", paths: ["/elsewhere/repo"] };
  const NESTED = { id: "nested-id", paths: ["/work/ws/inner"] };

  it("addresses a deck in a root that is not the workspace", () => {
    expect(storyWirePath("/elsewhere/repo/decks/talk.json", { workspaces: ["/work/ws"], roots: [WS_ROOT, OTHER] })).toEqual({
      filePath: "stories/decks/talk.json",
      root: "other-id",
    });
  });

  // Roots nest: a saved project inside the workspace is under both. The LONGEST match wins, so one
  // file has one identity — and it does not change when the server lists the roots in another
  // order, which would otherwise give the same deck two Canvas cards on two machines.
  it("takes the most specific root when they nest, whichever order they arrive in", () => {
    const nestedFirst = { workspaces: ["/work/ws"], roots: [NESTED, WS_ROOT] };
    const nestedLast = { workspaces: ["/work/ws"], roots: [WS_ROOT, NESTED] };
    const expected = { filePath: "stories/decks/talk.json", root: "nested-id" };
    expect(storyWirePath("/work/ws/inner/decks/talk.json", nestedFirst)).toEqual(expected);
    expect(storyWirePath("/work/ws/inner/decks/talk.json", nestedLast)).toEqual(expected);
  });

  // The workspace's own stories directory still answers with NO root, even though the workspace is
  // also a registered root that contains it. Two spellings for one file would be two cards.
  it("still answers the workspace's own stories directory without a root", () => {
    expect(storyWirePath("/work/ws/artifacts/stories/x.json", { workspaces: ["/work/ws"], roots: [WS_ROOT] })).toEqual({ filePath: "stories/x.json" });
  });

  // Under NO root, so no root-relative spelling is available — the deck travels as itself (#1976).
  it("names a path under no registered root by its absolute path", () => {
    expect(storyWirePath("/somewhere/else/deck.json", { workspaces: ["/work/ws"], roots: [WS_ROOT, OTHER] })).toEqual({
      filePath: "/somewhere/else/deck.json",
    });
  });

  // Before /api/config arrives the browser knows no roots. That used to mean "nothing is a story";
  // it now means "nothing has a root-relative spelling yet", and the absolute form covers the gap —
  // resolving to the same identity the root-relative card gets once the config lands.
  it("uses the absolute form before the config arrives", () => {
    expect(storyWirePath("/work/ws/decks/talk.json", { workspaces: [], roots: [] })).toEqual({ filePath: "/work/ws/decks/talk.json" });
  });
});
