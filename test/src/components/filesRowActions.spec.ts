import { describe, it, expect } from "vitest";
import { filesRowActions, menuFocusMove } from "../../../src/components/filesRowActions";

// What a tree row offers when it is right-clicked (#1859). Every rule here is about a path
// meaning something DIFFERENT at the other end than it does in the tree, which is why it is a
// pure function rather than an assertion about a menu.

const ids = (...args: Parameters<typeof filesRowActions>) => filesRowActions(...args).map((a) => a.id);
// Narrowed rather than asserted: only the insert entries carry text, which is the whole point of
// the union — the Canvas one has a path instead.
const textOf = (id: string, ...args: Parameters<typeof filesRowActions>) => {
  const action = filesRowActions(...args).find((a) => a.id === id);
  return action && "text" in action ? action.text : undefined;
};

// What the Canvas entry is offered on (#1923). The rule is not this module's: it asks
// canOpenInCanvas — the same gate the pane's own Canvas button is drawn from — so a row can never
// offer what that button would refuse.
describe("filesRowActions — the Canvas entry", () => {
  const WORKSPACE = "/ws";
  const inProject = { cwd: "/proj", terminal: { cwd: "/proj" }, canvas: { roots: { workspaces: [WORKSPACE], roots: [] } } };

  it("offers it on a file a plugin can render, before the inserts", () => {
    expect(ids({ ...inProject, pathRel: "notes/talk.md" })).toEqual(["open-canvas", "insert-relative", "insert-absolute"]);
    expect(ids({ ...inProject, pathRel: "site/page.html" })[0]).toBe("open-canvas");
  });

  // RELATIVE, because `open-in-canvas` already carries that from the pane's own button and the
  // receiver resolves it against the pane's cwd — an absolute one would be resolved twice.
  it("carries the row's path relative to the tree root", () => {
    const action = filesRowActions({ ...inProject, pathRel: "notes/talk.md" }).find((a) => a.id === "open-canvas");
    expect(action).toEqual({ id: "open-canvas", label: "Open in the Canvas", icon: "space_dashboard", pathRel: "notes/talk.md" });
  });

  it("offers nothing extra on a file no plugin renders", () => {
    expect(ids({ ...inProject, pathRel: "src/index.ts" })).toEqual(["insert-relative", "insert-absolute"]);
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
    expect(ids({ ...inProject, pathRel: "notes/talk.md", canvas: null })).toEqual(["insert-relative", "insert-absolute"]);
  });

  // The two halves are independent: the pane can trail a cell after a declined re-root, which is
  // why the pane keeps `canvasTarget` and `insertTarget` as separate props.
  it("stands alone when there is no terminal to insert into", () => {
    expect(ids({ ...inProject, pathRel: "notes/talk.md", terminal: null })).toEqual(["open-canvas"]);
  });
});

describe("filesRowActions", () => {
  const here = { pathRel: "src/index.ts", cwd: "/proj", terminal: { cwd: "/proj" }, canvas: null };

  it("offers both paths when the tree and the terminal are the same directory", () => {
    expect(ids(here)).toEqual(["insert-relative", "insert-absolute"]);
    expect(textOf("insert-relative", here)).toBe("src/index.ts ");
    expect(textOf("insert-absolute", here)).toBe("/proj/src/index.ts ");
  });

  // The pane keeps the cell it is on when a re-root could not be saved out of, so the tree and
  // the terminal on screen can be two different projects. `src/index.ts` would then name a file
  // in the wrong one — and it would exist, which is what makes this worth withholding.
  it("withholds the relative path when the terminal is in another directory", () => {
    const elsewhere = { ...here, terminal: { cwd: "/other" } };
    expect(ids(elsewhere)).toEqual(["insert-absolute"]);
    expect(textOf("insert-absolute", elsewhere)).toBe("/proj/src/index.ts ");
  });

  it("offers nothing where there is no terminal to insert into", () => {
    expect(ids({ ...here, terminal: null })).toEqual([]);
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
    expect(ids({ ...here, cwd: "/proj/", terminal: { cwd: "/proj" } })).toEqual(["insert-relative", "insert-absolute"]);
    expect(ids({ ...here, cwd: "/proj", terminal: { cwd: "/proj/" } })).toEqual(["insert-relative", "insert-absolute"]);
    expect(ids({ ...here, cwd: "C:\\proj\\", terminal: { cwd: "C:\\proj" } })).toEqual(["insert-relative", "insert-absolute"]);
  });

  // ...without collapsing two directories that only LOOK alike after the trim.
  it("still tells two different directories apart", () => {
    expect(ids({ ...here, cwd: "/proj/", terminal: { cwd: "/project" } })).toEqual(["insert-absolute"]);
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
