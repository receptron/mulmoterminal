import { describe, it, expect } from "vitest";
import { filesRowActions, menuFocusMove } from "../../../src/components/filesRowActions";
import { filesTreeEn } from "../../../src/i18n/filesTree/en";
import { filesTreeJa } from "../../../src/i18n/filesTree/ja";
import { filesTreeKo } from "../../../src/i18n/filesTree/ko";
import { filesTreeZhCN } from "../../../src/i18n/filesTree/zh-CN";
import { filesTreeZhTW } from "../../../src/i18n/filesTree/zh-TW";

// What a tree row offers when it is right-clicked (#1859). Every rule here is about a path
// meaning something DIFFERENT at the other end than it does in the tree, which is why it is a
// pure function rather than an assertion about a menu.

// `isDir: false` by default: every case written before #2039 is a file row, and spelling it at
// each call would say nothing. The folder rows have their own describe below.
type Target = Omit<Parameters<typeof filesRowActions>[0], "isDir"> & { isDir?: boolean };
const call = (t: Target) => filesRowActions({ isDir: false, ...t });
// The new-tab entry is left out of `ids`: it leads every FILE row's menu, and the cases below are
// about what follows it. Its own block pins where it goes and where it does not. So are the tree's
// file operations (#2578), which close every menu and have a block of their own at the end.
const FILE_OPS = ["new-file", "new-folder", "rename", "trash"];
const ids = (t: Target) =>
  call(t)
    .map((a) => a.id)
    .filter((id) => id !== "open-tab" && !FILE_OPS.includes(id));
// Narrowed rather than asserted: only the insert entries carry text, which is the whole point of
// the union — the Canvas one has a path instead.
const textOf = (id: string, t: Target) => {
  const action = call(t).find((a) => a.id === id);
  return action && "text" in action ? action.text : undefined;
};

// What the Canvas entry is offered on (#1923). The rule is not this module's: it asks
// canOpenInCanvas — the same gate the pane's own Canvas button is drawn from — so a row can never
// offer what that button would refuse.
describe("filesRowActions — the Canvas entry", () => {
  const WORKSPACE = "/ws";
  const inProject = { cwd: "/proj", terminal: { cwd: "/proj" }, canvas: { roots: { workspaces: [WORKSPACE], roots: [] } } };

  it("offers it on a file a plugin can render, before the inserts", () => {
    expect(ids({ ...inProject, pathRel: "notes/talk.md" })).toEqual(["open-canvas", "reveal", "insert-relative", "insert-absolute"]);
    expect(ids({ ...inProject, pathRel: "site/page.html" })[0]).toBe("open-canvas");
  });

  // RELATIVE, like the tab it is opened in: the Canvas view resolves it against the pane's cwd, so
  // an absolute one would be resolved twice.
  it("carries the row's path relative to the tree root", () => {
    const action = call({ ...inProject, pathRel: "notes/talk.md" }).find((a) => a.id === "open-canvas");
    expect(action).toEqual({ id: "open-canvas", labelKey: "filesRowMenu.openCanvas", icon: "space_dashboard", pathRel: "notes/talk.md" });
  });

  it("offers nothing extra on a file no plugin renders", () => {
    expect(ids({ ...inProject, pathRel: "src/index.ts" })).toEqual(["reveal", "insert-relative", "insert-absolute"]);
  });

  // A story in the WORKSPACE's own stories directory travels as `stories/…`; a project's own copy
  // of that path is a DIFFERENT file, which the plugin would not read under that spelling
  // (receptron/mulmoclaude#3014). Since #1976 it is still offered — by its absolute path, which
  // names the file the row actually points at — so the rule is about which spelling is minted, not
  // about whether the entry appears.
  it("offers it on a story in the workspace and on a project's own copy alike", () => {
    const inWorkspace = { cwd: WORKSPACE, terminal: { cwd: WORKSPACE }, canvas: { roots: { workspaces: [WORKSPACE], roots: [] } } };
    expect(ids({ ...inWorkspace, pathRel: "artifacts/stories/deck.json" })[0]).toBe("open-canvas");
    expect(ids({ ...inProject, pathRel: "artifacts/stories/deck.json" })[0]).toBe("open-canvas");
  });

  // #1976: the deck that has no root at all — the reason the entry was missing in the first place.
  it("offers it on a deck outside every registered root", () => {
    expect(ids({ ...inProject, pathRel: "decks/keynote.json" })[0]).toBe("open-canvas");
  });

  // The tree with no root behind it: the row alone is not a path anything can resolve, so nothing
  // is offered at all — the module's first rule, and the absolute form does not get around it.
  it("still offers nothing when the tree has no root", () => {
    expect(ids({ ...inProject, cwd: null, pathRel: "decks/keynote.json" })).toEqual([]);
  });

  // The full-screen Files view mounts the same pane with no cell to put a Canvas beside.
  it("offers nothing where there is no cell to draw beside", () => {
    expect(ids({ ...inProject, pathRel: "notes/talk.md", canvas: null })).toEqual(["reveal", "insert-relative", "insert-absolute"]);
  });

  // The two halves are independent: the pane can trail a cell after a declined re-root, which is
  // why the pane keeps `canvasTarget` and `insertTarget` as separate props.
  it("stands alone when there is no terminal to insert into", () => {
    expect(ids({ ...inProject, pathRel: "notes/talk.md", terminal: null })).toEqual(["open-canvas", "reveal"]);
  });
});

describe("filesRowActions", () => {
  const here = { pathRel: "src/index.ts", cwd: "/proj", terminal: { cwd: "/proj" }, canvas: null };

  it("offers both paths when the tree and the terminal are the same directory", () => {
    expect(ids(here)).toEqual(["reveal", "insert-relative", "insert-absolute"]);
    expect(textOf("insert-relative", here)).toBe("src/index.ts ");
    expect(textOf("insert-absolute", here)).toBe("/proj/src/index.ts ");
  });

  // The pane keeps the cell it is on when a re-root could not be saved out of, so the tree and
  // the terminal on screen can be two different projects. `src/index.ts` would then name a file
  // in the wrong one — and it would exist, which is what makes this worth withholding.
  it("withholds the relative path when the terminal is in another directory", () => {
    const elsewhere = { ...here, terminal: { cwd: "/other" } };
    expect(ids(elsewhere)).toEqual(["reveal", "insert-absolute"]);
    expect(textOf("insert-absolute", elsewhere)).toBe("/proj/src/index.ts ");
  });

  it("offers nothing where there is no terminal to insert into", () => {
    expect(ids({ ...here, terminal: null })).toEqual(["reveal"]);
  });

  // Both are unreachable from the grid, which always has a root — but the pane takes `cwd: null`
  // in its type and the overlay mounts it that way, so neither may produce a path.
  it("offers nothing without a root, and nothing for an empty path", () => {
    expect(ids({ ...here, cwd: null })).toEqual([]);
    expect(ids({ ...here, pathRel: "" })).toEqual([]);
    expect(ids({ pathRel: "", cwd: null, terminal: null, canvas: null })).toEqual([]);
  });

  // A directory is a path like any other, and gets no trailing slash: what the agent is being
  // handed is a name, and the tools it passes it to take it either way.
  it("treats a directory row as a plain path", () => {
    expect(textOf("insert-relative", { ...here, pathRel: "src" })).toBe("src ");
    expect(textOf("insert-absolute", { ...here, pathRel: "src" })).toBe("/proj/src ");
  });

  // toInsertText's rules, pinned here because this is where they reach a terminal: quoted when
  // the path is not shell-safe, and always ending in a space so a second insert is not glued on.
  it("quotes a path a shell would otherwise split, and keeps the trailing separator", () => {
    const spaced = { ...here, pathRel: "my docs/a b.md" };
    expect(textOf("insert-relative", spaced)).toBe("'my docs/a b.md' ");
    expect(textOf("insert-absolute", spaced)).toBe("'/proj/my docs/a b.md' ");
  });

  it("joins a Windows root the way absoluteUnder does, and quotes the result", () => {
    const win = { pathRel: "docs/x.md", cwd: "C:\\Users\\me", terminal: { cwd: "C:\\Users\\me" }, canvas: null };
    expect(textOf("insert-absolute", win)).toBe("'C:\\Users\\me/docs/x.md' ");
  });

  it("does not double a separator the root already ends with", () => {
    expect(textOf("insert-absolute", { ...here, cwd: "/proj/", terminal: { cwd: "/proj/" } })).toBe("/proj/src/index.ts ");
  });

  // The two roots reach this from different cells, so nothing guarantees one spelling — and
  // `absoluteUnder` already builds the SAME absolute path from either, so the equality test has
  // to agree with it. Both asymmetries, since only one of them is the obvious way round.
  it("reads a root with and without a trailing separator as the same directory", () => {
    expect(ids({ ...here, cwd: "/proj/", terminal: { cwd: "/proj" } })).toEqual(["reveal", "insert-relative", "insert-absolute"]);
    expect(ids({ ...here, cwd: "/proj", terminal: { cwd: "/proj/" } })).toEqual(["reveal", "insert-relative", "insert-absolute"]);
    expect(ids({ ...here, cwd: "C:\\proj\\", terminal: { cwd: "C:\\proj" } })).toEqual(["reveal", "insert-relative", "insert-absolute"]);
  });

  // ...without collapsing two directories that only LOOK alike after the trim.
  it("still tells two different directories apart", () => {
    expect(ids({ ...here, cwd: "/proj/", terminal: { cwd: "/project" } })).toEqual(["reveal", "insert-absolute"]);
  });
});

describe("menuFocusMove", () => {
  it("wraps both ways round a two-item menu", () => {
    expect(menuFocusMove("ArrowDown", 0, 2)).toBe(1);
    expect(menuFocusMove("ArrowDown", 1, 2)).toBe(0);
    expect(menuFocusMove("ArrowUp", 1, 2)).toBe(0);
    expect(menuFocusMove("ArrowUp", 0, 2)).toBe(1);
  });

  it("answers the two ends when focus is not on an item yet", () => {
    expect(menuFocusMove("ArrowDown", -1, 3)).toBe(0);
    expect(menuFocusMove("ArrowUp", -1, 3)).toBe(2);
  });

  it("jumps to either end", () => {
    expect(menuFocusMove("Home", 2, 3)).toBe(0);
    expect(menuFocusMove("End", 0, 3)).toBe(2);
  });

  it("leaves every other key, and an empty menu, alone", () => {
    expect(menuFocusMove("Enter", 0, 2)).toBeNull();
    expect(menuFocusMove("a", 0, 2)).toBeNull();
    expect(menuFocusMove("ArrowDown", 0, 0)).toBeNull();
    expect(menuFocusMove("Home", -1, 0)).toBeNull();
  });

  it("stays put in a one-item menu", () => {
    expect(menuFocusMove("ArrowDown", 0, 1)).toBe(0);
    expect(menuFocusMove("ArrowUp", 0, 1)).toBe(0);
  });
});

// The entry that hands a file to ANOTHER app (#2039): dragged into a mail composer or an upload
// form, or a file too big to paste dropped into a folder the agent reads. Not for reading it —
// which is why it is offered where the Canvas entry is not, and where there is no terminal.
describe("filesRowActions — showing a row in the OS file manager", () => {
  const here = { cwd: "/proj", terminal: { cwd: "/proj" }, canvas: null };
  const reveal = (t: Parameters<typeof ids>[0]) => call(t).find((a) => a.id === "reveal");

  // ABSOLUTE: the route spawns an OS command and takes nothing else. The Canvas entry is relative
  // for the opposite reason — its receiver resolves against the pane's cwd.
  it("carries the row's absolute path", () => {
    expect(reveal({ ...here, pathRel: "reports/2026-08.pdf" })).toEqual({
      id: "reveal",
      labelKey: "filesRowMenu.showInFolder",
      icon: "folder_open",
      pathAbs: "/proj/reports/2026-08.pdf",
    });
  });

  // The row the user right-clicked IS the folder they want in front of them, so the wording says
  // so — "Show in folder" would promise its parent.
  it("says something different on a folder row", () => {
    const action = reveal({ ...here, pathRel: "reports", isDir: true });
    expect(action?.labelKey).toBe("filesRowMenu.openFolder");
    expect(action).toMatchObject({ pathAbs: "/proj/reports" });
  });

  // Both uses — sending a file on, and dropping one where the agent will read it — work in the
  // full-screen view, which has no terminal to insert into.
  it("is offered where there is no terminal, unlike the inserts", () => {
    expect(ids({ ...here, pathRel: "reports/2026-08.pdf", terminal: null })).toEqual(["reveal"]);
  });

  // The early return still governs: without a root the row's path resolves to nothing, and an
  // absolute path is exactly what this entry needs.
  it("is withheld when the tree has no root", () => {
    expect(ids({ ...here, pathRel: "reports/2026-08.pdf", cwd: null })).toEqual([]);
  });

  it("joins a root that already ends in a separator without doubling it", () => {
    expect(reveal({ ...here, cwd: "/proj/", pathRel: "a.pdf" })?.pathAbs).toBe("/proj/a.pdf");
  });

  // `absoluteUnder` joins with `/` whatever the root looks like, so a Windows root comes out with
  // MIXED separators — pinned here because it is what the route receives, and `explorer /select,`
  // is particular about them. Straightening it is the SERVER's job (it is the side that knows the
  // platform); see `server/files/reveal.ts`.
  it("hands a Windows root over with mixed separators, for the server to straighten", () => {
    expect(reveal({ ...here, cwd: "C:\\proj", pathRel: "reports/a.pdf" })?.pathAbs).toBe("C:\\proj/reports/a.pdf");
  });
});

describe("filesRowActions — opening a file in a new tab (#2267)", () => {
  const here = { cwd: "/proj", terminal: { cwd: "/proj" }, canvas: null };
  const allIds = (t: Target) => call(t).map((a) => a.id);

  it("leads a file row's menu, carrying the row's relative path", () => {
    const actions = call({ ...here, pathRel: "src/index.ts" });
    expect(actions[0]).toEqual({ id: "open-tab", labelKey: "filesRowMenu.openTab", icon: "tab", pathRel: "src/index.ts" });
  });

  it("is offered with no terminal beside the pane — reading a file needs none", () => {
    expect(allIds({ ...here, pathRel: "src/index.ts", terminal: null }).filter((id) => !FILE_OPS.includes(id))).toEqual(["open-tab", "reveal"]);
  });

  it("is not offered on a folder, which has nothing to show in a tab", () => {
    expect(allIds({ ...here, pathRel: "src", isDir: true })).not.toContain("open-tab");
  });

  it("is not offered where no row path can be resolved", () => {
    expect(allIds({ ...here, pathRel: "src/index.ts", cwd: null })).toEqual([]);
  });
});

// #3079. A folder leads with "Open as gallery", as a file leads with its new tab.
describe("filesRowActions — opening a folder as a gallery", () => {
  const here = { cwd: "/proj", terminal: null, canvas: null };

  it("leads a folder row's menu, carrying the row's relative path", () => {
    expect(call({ ...here, pathRel: "assets/shots", isDir: true })[0]).toEqual({
      id: "open-gallery",
      labelKey: "filesRowMenu.openGallery",
      icon: "photo_library",
      pathRel: "assets/shots",
    });
  });

  it("is not offered on a file, the root, or where no row path can be resolved", () => {
    const has = (t: Target) => call(t).some((a) => a.id === "open-gallery");
    expect(has({ ...here, pathRel: "a.png" })).toBe(false);
    expect(has({ ...here, pathRel: "", isDir: true })).toBe(false);
    expect(has({ ...here, pathRel: "assets", isDir: true, cwd: null })).toBe(false);
  });
});

// #2578. New, rename and Trash, last in every row's menu. A new entry goes in the row's folder, or
// beside a file row; the Trash is offered only where the server has one.
describe("filesRowActions — the tree's file operations (#2578)", () => {
  const row = { cwd: "/proj", terminal: null, canvas: null };
  const opsOf = (t: Target) => call(t).filter((a) => FILE_OPS.includes(a.id));

  it("closes the menu with new, rename and, where there is a Trash, Move to Trash", () => {
    const actions = call({ ...row, pathRel: "src/a.ts", trash: true });
    expect(actions.slice(-4).map((a) => a.id)).toEqual(FILE_OPS);
  });

  it("offers no Trash where there is none", () => {
    expect(opsOf({ ...row, pathRel: "src/a.ts" }).map((a) => a.id)).toEqual(["new-file", "new-folder", "rename"]);
  });

  it.each([
    ["a file row, beside it", "src/a.ts", false, "src"],
    ["a file at the root, at the root", "a.ts", false, ""],
    ["a folder row, inside it", "src/lib", true, "src/lib"],
  ])("puts a new entry for %s", (_case, pathRel, isDir, dirRel) => {
    const created = opsOf({ ...row, pathRel, isDir }).find((a) => a.id === "new-file");
    expect(created && "dirRel" in created ? created.dirRel : null).toBe(dirRel);
  });

  it("renames and trashes the row itself", () => {
    const ops = opsOf({ ...row, pathRel: "src/lib", isDir: true, trash: true });
    expect(ops.filter((a) => "pathRel" in a).map((a) => ("pathRel" in a ? a.pathRel : null))).toEqual(["src/lib", "src/lib"]);
  });

  it("offers nothing without a root to resolve against", () => {
    expect(opsOf({ ...row, cwd: null, pathRel: "a.ts", trash: true })).toEqual([]);
  });

  // #2694. The root itself (the tree's empty space, an empty folder): something new, and nothing else.
  it("offers only a new file or folder at the root", () => {
    expect(call({ ...row, pathRel: "", isDir: true, trash: true })).toEqual([
      { id: "new-file", labelKey: "filesRowMenu.newFile", icon: "note_add", dirRel: "", rowRel: "" },
      { id: "new-folder", labelKey: "filesRowMenu.newFolder", icon: "create_new_folder", dirRel: "", rowRel: "" },
    ]);
  });
});

// Every item's words exist in every language the app ships.
describe("filesRowActions — words", () => {
  it("names each item by a key every locale has", () => {
    const locales: Record<string, unknown>[] = [filesTreeEn, filesTreeJa, filesTreeKo, filesTreeZhCN, filesTreeZhTW].map((locale) => locale.filesRowMenu);
    const all = [
      ...call({ pathRel: "src/a.ts", cwd: "/proj", terminal: { cwd: "/proj" }, canvas: null, trash: true }),
      ...call({ pathRel: "src", isDir: true, cwd: "/proj", terminal: null, canvas: null }),
    ];
    all.forEach((action) => {
      const key = action.labelKey.replace("filesRowMenu.", "");
      locales.forEach((strings) => expect(typeof strings[key], action.labelKey).toBe("string"));
    });
  });
});

// "Open as a spreadsheet" (CSV / TSV): a copy on the Canvas of the cell beside the pane, so it is
// offered only where there is such a cell, and only on the files the table Preview reads.
describe("filesRowActions — the spreadsheet entry", () => {
  const inPane = { cwd: "/proj", terminal: { cwd: "/proj" }, canvas: { roots: { workspaces: ["/ws"], roots: [] } } };

  it("is offered on a CSV and a TSV, after the Canvas entry would be", () => {
    expect(ids({ ...inPane, pathRel: "data/sales.csv" })).toEqual(["open-spreadsheet", "reveal", "insert-relative", "insert-absolute"]);
    expect(ids({ ...inPane, pathRel: "data/SALES.TSV" })[0]).toBe("open-spreadsheet");
  });

  it("carries the row's relative path", () => {
    const action = call({ ...inPane, pathRel: "data/sales.csv" }).find((a) => a.id === "open-spreadsheet");
    expect(action).toEqual({ id: "open-spreadsheet", labelKey: "filesRowMenu.openSpreadsheet", icon: "table_view", pathRel: "data/sales.csv" });
  });

  it("is not offered without a cell's Canvas, on a folder, or on another kind of file", () => {
    expect(ids({ ...inPane, canvas: null, pathRel: "data/sales.csv" })).not.toContain("open-spreadsheet");
    expect(call({ ...inPane, isDir: true, pathRel: "data.csv" }).map((a) => a.id)).not.toContain("open-spreadsheet");
    expect(ids({ ...inPane, pathRel: "data/sales.json" })).not.toContain("open-spreadsheet");
  });

  it("is worded in every language", () => {
    [filesTreeEn, filesTreeJa, filesTreeKo, filesTreeZhCN, filesTreeZhTW].forEach((messages) => {
      const menu = messages.filesRowMenu;
      [menu.openSpreadsheet, menu.spreadsheetEmpty, menu.spreadsheetTooLarge, menu.spreadsheetFailed, menu.spreadsheetNoCell, menu.spreadsheetNotShown].forEach(
        (text) => expect(text).toBeTruthy(),
      );
      expect(menu.spreadsheetTooLarge).toContain("{max}");
      expect(menu.spreadsheetFailed).toContain("{reason}");
    });
  });
});

// #3506. A root on a remote host: its rows still open, insert and change files there, but this
// machine's file manager cannot show them, and the gallery lists and loads through this machine's routes.
describe("filesRowActions — a root on a remote host", () => {
  const remote = { cwd: "/srv/proj", terminal: { cwd: "/srv/proj" }, canvas: null, trash: true, onThisMachine: false };
  it("offers no reveal on a file or a folder, and no gallery", () => {
    expect(ids({ ...remote, pathRel: "a.md" })).toEqual(["insert-relative", "insert-absolute"]);
    expect(ids({ ...remote, pathRel: "shots", isDir: true })).toEqual(["insert-relative", "insert-absolute"]);
  });
  it("keeps the new tab and the file operations", () => {
    expect(call({ ...remote, pathRel: "a.md" }).map((a) => a.id)).toEqual(["open-tab", "insert-relative", "insert-absolute", ...FILE_OPS]);
  });
  it("offers both on this machine (control)", () => {
    expect(ids({ ...remote, onThisMachine: true, pathRel: "shots", isDir: true })).toEqual(["open-gallery", "reveal", "insert-relative", "insert-absolute"]);
  });
});
