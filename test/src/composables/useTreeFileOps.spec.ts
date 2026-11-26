import { describe, it, expect, vi, beforeEach } from "vitest";
import { defineComponent, h, ref } from "vue";
import { mount } from "@vue/test-utils";
import type { TabStrip } from "../../../src/components/filesTabs";
import type { TreeNode } from "../../../src/composables/useFilesTree";

// #2578. The tree's file operations: the server is stubbed; what is pinned is what this end asks,
// and what it does to the tabs and the tree around the call.
const { treeOp, trashAvailable } = vi.hoisted(() => ({
  treeOp: vi.fn(),
  trashAvailable: vi.fn(async () => true),
}));
vi.mock("../../../src/components/treeFileOpsApi", () => ({ treeOp, trashAvailable }));
const { useTreeFileOps } = await import("../../../src/composables/useTreeFileOps");

/** `frontState`: where the reader is in the front file, which the real `current()` adds to the front tab
 *  only while that file is open — putting it down (`close`) takes it away. */
function setup(strip: TabStrip, answers: { ask?: string | null; confirm?: boolean } = {}, frontState: Partial<TabStrip["tabs"][number]> = {}) {
  const tabsStrip = ref<TabStrip>(strip);
  let frontOpen = true;
  const withFrontState = (s: TabStrip): TabStrip =>
    frontOpen ? { ...s, tabs: s.tabs.map((tab) => (tab.path === s.activePath ? { ...tab, ...frontState } : tab)) } : s;
  const dirs = new Map<string, TreeNode>();
  const fileError = ref<string | null>(null);
  const root = ref("/proj");
  const deps = {
    cwd: () => root.value,
    focusRow: vi.fn<(path: string) => boolean>(() => true),
    changed: vi.fn(),
    tree: {
      refresh: vi.fn(async () => {}),
      findNode: (path: string) => dirs.get(path) ?? null,
      toggleDir: vi.fn(async (node: TreeNode) => {
        node.expanded = true;
      }),
    },
    tabs: {
      strip: tabsStrip,
      current: () => withFrontState(tabsStrip.value),
      // As the real one does: reopening the front file clears the pane's error line.
      restore: vi.fn(async (next: TabStrip) => {
        tabsStrip.value = next;
        fileError.value = null;
      }),
      open: vi.fn(async () => {}),
    },
    file: {
      close: vi.fn(async () => {
        frontOpen = false;
        return true;
      }),
      fileError,
    },
    t: (key: string) => key,
    ask: vi.fn(() => (answers.ask === undefined ? "new.md" : answers.ask)),
    confirm: vi.fn(() => answers.confirm ?? true),
  };
  const holder: { ops: ReturnType<typeof useTreeFileOps> | null } = { ops: null };
  mount(
    defineComponent({
      setup() {
        holder.ops = useTreeFileOps(deps);
        return () => h("div");
      },
    }),
  );
  if (!holder.ops) throw new Error("not mounted");
  return { ops: holder.ops, deps, tabsStrip, dirs, root };
}

const STRIP: TabStrip = { tabs: [{ path: "a.md" }, { path: "src/x.ts" }], activePath: "src/x.ts" };

beforeEach(() => treeOp.mockReset());

describe("useTreeFileOps", () => {
  it("creates a file in the folder, opens that folder, and opens the file", async () => {
    treeOp.mockResolvedValue({ ok: true, path: "src/new.md" });
    const { ops, deps, dirs } = setup(STRIP);
    const src: TreeNode = { name: "src", path: "src", dir: true, expanded: false, loaded: false, children: [], size: 0 };
    dirs.set("src", src);
    await ops.run({ id: "new-file", labelKey: "", icon: "", dirRel: "src", rowRel: "src" });
    expect(treeOp).toHaveBeenCalledWith(null, "create", "cwd=%2Fproj&path=src", { name: "new.md", kind: "file" });
    expect(deps.tree.toggleDir).toHaveBeenCalledWith(src);
    // On its editor, whatever view the pane carries (#3075): a file just made is there to be written.
    expect(deps.tabs.open).toHaveBeenCalledWith("src/new.md", false, { path: "src/new.md" });
  });

  // A folder opened once and collapsed keeps its old listing; it is read again before it opens.
  it("reads a folder again before opening it, so the new entry is in it", async () => {
    treeOp.mockResolvedValue({ ok: true, path: "src/n.ts" });
    const { ops, deps, dirs } = setup(STRIP, { ask: "n.ts" });
    const src: TreeNode = { name: "src", path: "src", dir: true, expanded: false, loaded: true, children: [], size: 0 };
    dirs.set("src", src);
    await ops.run({ id: "new-file", labelKey: "", icon: "", dirRel: "src", rowRel: "src" });
    expect(deps.tree.refresh).toHaveBeenCalledWith("src");
    expect(deps.tree.refresh.mock.invocationCallOrder[0]).toBeLessThan(deps.tree.toggleDir.mock.invocationCallOrder[0] ?? 0);
  });

  it("asks nothing of the server when the name is cancelled", async () => {
    const { ops } = setup(STRIP, { ask: null });
    await ops.run({ id: "new-folder", labelKey: "", icon: "", dirRel: "", rowRel: "a.md" });
    expect(treeOp).not.toHaveBeenCalled();
  });

  // The front file is put down first, then comes back under its new name.
  it("renames the front file and keeps its tab, reopened at the new name", async () => {
    treeOp.mockResolvedValue({ ok: true, path: "src/y.ts" });
    const { ops, deps, tabsStrip } = setup(STRIP, { ask: "y.ts" });
    await ops.run({ id: "rename", labelKey: "", icon: "", pathRel: "src/x.ts", isDir: false });
    expect(deps.file.close).toHaveBeenCalled();
    expect(deps.tree.refresh).toHaveBeenCalledWith("src");
    expect(tabsStrip.value).toEqual({ tabs: [{ path: "a.md" }, { path: "src/y.ts" }], activePath: "src/y.ts" });
  });

  it("renames a folder behind the front tab without putting the front file down", async () => {
    treeOp.mockResolvedValue({ ok: true, path: "lib" });
    const { ops, deps, tabsStrip } = setup({ tabs: [{ path: "a.md" }, { path: "src/x.ts" }], activePath: "a.md" }, { ask: "lib" });
    await ops.run({ id: "rename", labelKey: "", icon: "", pathRel: "src", isDir: true });
    expect(deps.file.close).not.toHaveBeenCalled();
    expect(tabsStrip.value).toEqual({ tabs: [{ path: "a.md" }, { path: "lib/x.ts" }], activePath: "a.md" });
  });

  it("changes nothing when the front file cannot be put down", async () => {
    const { ops, deps } = setup(STRIP, { ask: "y.ts" });
    deps.file.close.mockResolvedValue(false);
    await ops.run({ id: "rename", labelKey: "", icon: "", pathRel: "src/x.ts", isDir: false });
    expect(treeOp).not.toHaveBeenCalled();
  });

  // Reopening the front file clears the error line, so the refusal is said after it is back up.
  it.each([
    ["rename", { id: "rename" as const, labelKey: "", icon: "", pathRel: "src/x.ts", isDir: false }],
    ["trash", { id: "trash" as const, labelKey: "", icon: "", pathRel: "src/x.ts", isDir: false }],
  ])("says why when the server refuses a %s of the front file, after bringing it back", async (_case, action) => {
    treeOp.mockResolvedValue({ ok: false, message: "refused" });
    const { ops, deps, tabsStrip } = setup(STRIP, { ask: "a.md" });
    await ops.run(action);
    expect(deps.tabs.restore).toHaveBeenCalled();
    expect(deps.file.fileError.value).toBe("refused");
    expect(tabsStrip.value).toEqual(STRIP);
  });

  // The front file did not move, so the strip as it is NOW gets the change: a tab opened while the
  // request was out stays.
  it("keeps a tab opened while a rename behind the front was in flight", async () => {
    const { ops, tabsStrip } = setup({ tabs: [{ path: "a.md" }, { path: "src/x.ts" }], activePath: "a.md" }, { ask: "lib" });
    treeOp.mockImplementation(async () => {
      tabsStrip.value = { tabs: [...tabsStrip.value.tabs, { path: "c.md" }], activePath: "c.md" };
      return { ok: true, path: "lib" };
    });
    await ops.run({ id: "rename", labelKey: "", icon: "", pathRel: "src", isDir: true });
    expect(tabsStrip.value).toEqual({ tabs: [{ path: "a.md" }, { path: "lib/x.ts" }, { path: "c.md" }], activePath: "c.md" });
  });

  it("asks first, then moves to the Trash and closes the tabs on it", async () => {
    treeOp.mockResolvedValue({ ok: true, path: null });
    const { ops, deps, tabsStrip } = setup(STRIP);
    await ops.run({ id: "trash", labelKey: "", icon: "", pathRel: "src", isDir: true });
    expect(deps.confirm).toHaveBeenCalled();
    expect(treeOp).toHaveBeenCalledWith(null, "trash", "cwd=%2Fproj&path=src", {});
    expect(tabsStrip.value).toEqual({ tabs: [{ path: "a.md" }], activePath: "a.md" });
    expect(deps.tree.refresh).toHaveBeenCalledWith("");
  });

  it("moves nothing when the question is declined", async () => {
    const { ops } = setup(STRIP, { confirm: false });
    await ops.run({ id: "trash", labelKey: "", icon: "", pathRel: "a.md", isDir: false });
    expect(treeOp).not.toHaveBeenCalled();
  });

  it("learns from the server whether there is a Trash", async () => {
    const { ops } = setup(STRIP);
    await Promise.resolve();
    await Promise.resolve();
    expect(ops.trash.value).toBe(true);
  });

  // The menu that asked is gone, and after a rename or a Trash so may be its row: the keyboard is put
  // on the row the operation leaves behind.
  it.each([
    ["the new file", { id: "new-file" as const, labelKey: "", icon: "", dirRel: "src", rowRel: "src" }, { ok: true, path: "src/new.md" }, "src/new.md"],
    ["the renamed entry", { id: "rename" as const, labelKey: "", icon: "", pathRel: "a.md", isDir: false }, { ok: true, path: "new.md" }, "new.md"],
    ["the folder a trashed entry was in", { id: "trash" as const, labelKey: "", icon: "", pathRel: "src/x.ts", isDir: false }, { ok: true, path: null }, "src"],
    ["the row itself when refused", { id: "rename" as const, labelKey: "", icon: "", pathRel: "a.md", isDir: false }, { ok: false, message: "no" }, "a.md"],
  ])("puts the keyboard on %s, and reads the git marks again", async (_case, action, answer, landing) => {
    treeOp.mockResolvedValue(answer);
    const { ops, deps } = setup(STRIP);
    await ops.run(action);
    expect(deps.focusRow).toHaveBeenLastCalledWith(landing);
    expect(deps.changed).toHaveBeenCalled();
  });

  // A top-level entry's folder is the root, which has no row: the keyboard goes to the row the menu was
  // opened on if it is still there, else the first row — never the page.
  // #2694. The front file moved, but the reader turned to another file while the request was out: that
  // one stays in front, and the moved file's tab is renamed in place without being reopened over it.
  it("keeps a file opened meanwhile in front when the front file was renamed", async () => {
    const { ops, deps, tabsStrip } = setup(STRIP, { ask: "y.ts" });
    treeOp.mockImplementation(async () => {
      tabsStrip.value = { tabs: [...tabsStrip.value.tabs, { path: "c.md" }], activePath: "c.md" };
      return { ok: true, path: "src/y.ts" };
    });
    await ops.run({ id: "rename", labelKey: "", icon: "", pathRel: "src/x.ts", isDir: false });
    expect(deps.tabs.restore).not.toHaveBeenCalled();
    expect(tabsStrip.value).toEqual({ tabs: [{ path: "a.md" }, { path: "src/y.ts" }, { path: "c.md" }], activePath: "c.md" });
  });

  // #2694. Where the reader was in the front file (Preview, the scroll) survives its rename: the file is
  // put down before the move, so only the strip from BEFORE still holds it.
  it("reopens a renamed front file where the reader was in it", async () => {
    treeOp.mockResolvedValue({ ok: true, path: "src/y.ts" });
    const { ops, tabsStrip } = setup(STRIP, { ask: "y.ts" }, { showPreview: true, topLine: 130 });
    await ops.run({ id: "rename", labelKey: "", icon: "", pathRel: "src/x.ts", isDir: false });
    expect(tabsStrip.value.tabs[1]).toEqual({ path: "src/y.ts", showPreview: true, topLine: 130 });
    expect(tabsStrip.value.activePath).toBe("src/y.ts");
  });

  // Still on the moved file, but a tab was opened behind it meanwhile: that tab stays too.
  it("keeps a tab opened behind the front while the front file was renamed", async () => {
    const { ops, tabsStrip } = setup(STRIP, { ask: "y.ts" });
    treeOp.mockImplementation(async () => {
      tabsStrip.value = { ...tabsStrip.value, tabs: [...tabsStrip.value.tabs, { path: "c.md" }] };
      return { ok: true, path: "src/y.ts" };
    });
    await ops.run({ id: "rename", labelKey: "", icon: "", pathRel: "src/x.ts", isDir: false });
    expect(tabsStrip.value).toEqual({ tabs: [{ path: "a.md" }, { path: "src/y.ts" }, { path: "c.md" }], activePath: "src/y.ts" });
  });

  // #2694. The landing (the folder the entry left) has no row, but the row the menu was opened on
  // does: the keyboard goes there, not to the top.
  it("falls back from a landing with no row to the row the menu was opened on", async () => {
    treeOp.mockResolvedValue({ ok: true });
    const { ops, deps } = setup({ tabs: [], activePath: null });
    deps.focusRow.mockImplementation((path: string) => path === "src/x.ts");
    await ops.run({ id: "trash", labelKey: "", icon: "", pathRel: "src/x.ts", isDir: false });
    expect(deps.focusRow.mock.calls.map((c) => c[0])).toEqual(["src", "src/x.ts"]);
  });

  it("falls back from a landing with no row to the opener, then the first row", async () => {
    treeOp.mockResolvedValue({ ok: true, path: null });
    const { ops, deps } = setup(STRIP);
    deps.focusRow.mockImplementation((path: string) => path === "");
    await ops.run({ id: "trash", labelKey: "", icon: "", pathRel: "a.md", isDir: false });
    expect(deps.focusRow.mock.calls.map((c) => c[0])).toEqual([""]);
  });

  it("puts the keyboard back on the row when the name is cancelled", async () => {
    const { ops, deps } = setup(STRIP, { ask: null });
    await ops.run({ id: "rename", labelKey: "", icon: "", pathRel: "a.md", isDir: false });
    expect(deps.focusRow).toHaveBeenLastCalledWith("a.md");
  });

  // A dirty front file is saved before it is put down — a round trip in which the pane can move on; the
  // same relative path in the other folder must not be trashed.
  it("asks the server nothing when the pane moved while the front file was being saved", async () => {
    const { ops, deps, root } = setup(STRIP);
    deps.file.close.mockImplementation(async () => {
      root.value = "/other";
      return true;
    });
    await ops.run({ id: "trash", labelKey: "", icon: "", pathRel: "src/x.ts", isDir: false });
    expect(treeOp).not.toHaveBeenCalled();
  });

  it("stops before touching the tabs when the pane moved while the folder was read again", async () => {
    treeOp.mockResolvedValue({ ok: true, path: "src/y.ts" });
    const { ops, deps, root } = setup(STRIP, { ask: "y.ts" });
    deps.tree.refresh.mockImplementation(async () => {
      root.value = "/other";
    });
    await ops.run({ id: "rename", labelKey: "", icon: "", pathRel: "src/x.ts", isDir: false });
    expect(deps.tabs.restore).not.toHaveBeenCalled();
    expect(deps.focusRow).not.toHaveBeenCalled();
  });

  // The pane was re-rooted while the request was out: nothing of it is applied to the new folder.
  it("applies nothing when the pane moved to another folder meanwhile", async () => {
    const { ops, deps, tabsStrip, root } = setup(STRIP, { ask: "y.ts" });
    treeOp.mockImplementation(async () => {
      root.value = "/other";
      tabsStrip.value = { tabs: [{ path: "src/x.ts" }], activePath: "src/x.ts" };
      return { ok: false, message: "late" };
    });
    await ops.run({ id: "rename", labelKey: "", icon: "", pathRel: "src/x.ts", isDir: false });
    expect(deps.tabs.restore).not.toHaveBeenCalled();
    expect(deps.tree.refresh).not.toHaveBeenCalled();
    expect(deps.file.fileError.value).toBeNull();
    expect(deps.focusRow).not.toHaveBeenCalled();
    expect(tabsStrip.value).toEqual({ tabs: [{ path: "src/x.ts" }], activePath: "src/x.ts" });
  });
});
