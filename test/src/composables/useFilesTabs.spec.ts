import { describe, it, expect, vi } from "vitest";
import { computed, ref, shallowRef } from "vue";
import { useFilesTabs } from "../../../src/composables/useFilesTabs";
import type { OpenFile } from "../../../src/composables/useOpenFile";
import type { FilesTabState } from "../../../src/components/filesPaneState";

interface FakeFile {
  file: OpenFile;
  loads: { path: string; remembered: FilesTabState | null }[];
  /** Paths whose read does not land. */
  failing: Set<string>;
  /** Whether leaving the open file is refused — its edits could be neither saved nor banked. */
  stuck: { value: boolean };
}

/** An open file whose only moving parts are the ones the tabs drive: which path is on screen, and
 *  whether a load or a close moved it. Everything else is inert. */
function fakeFile(): FakeFile {
  const openPath = ref<string | null>(null);
  const loads: FakeFile["loads"] = [];
  const failing = new Set<string>();
  const stuck = { value: false };
  const file: OpenFile = {
    openPath,
    openName: computed(() => openPath.value ?? ""),
    isMarkdown: computed(() => false),
    previewKind: computed(() => null),
    dirty: ref(false),
    editSeq: ref(0),
    saving: ref(false),
    fileError: ref<string | null>(null),
    unpreviewable: ref<string | null>(null),
    baseVersion: ref<string | null>(null),
    grantedMediaSrc: ref<string | null>(null),
    conflict: ref(null),
    showPreview: ref(false),
    previewScrollTop: ref(0),
    dirConfigReport: ref(null),
    editor: shallowRef(null),
    previewSrc: computed(() => ""),
    previewToken: computed(() => null),
    generation: () => 0,
    attach: vi.fn(),
    teardown: vi.fn(),
    load: async (path, _force, remembered) => {
      loads.push({ path, remembered: remembered ?? null });
      if (path === openPath.value || stuck.value || failing.has(path)) return;
      openPath.value = path;
    },
    flush: async () => !stuck.value,
    close: async () => {
      if (stuck.value) return false;
      openPath.value = null;
      return true;
    },
    save: vi.fn(),
    togglePreview: vi.fn(),
    savedInPlace: vi.fn(async () => true),
    discardAndReload: vi.fn(),
    overwrite: vi.fn(),
    openInOs: vi.fn(),
    reportFailure: vi.fn(),
    place: () => ({ caret: { line: 5, col: 0 } }),
  };
  return { file, loads, failing, stuck };
}

describe("useFilesTabs (#2267)", () => {
  it("closes the only tab to an empty pane", async () => {
    const f = fakeFile();
    const tabs = useFilesTabs(f.file);
    await tabs.open("a");
    await tabs.close("a");

    expect(tabs.strip.value).toEqual({ tabs: [], activePath: null });
    expect(f.file.openPath.value).toBeNull();
  });

  it("keeps the tab when the file it shows cannot be left", async () => {
    const f = fakeFile();
    const tabs = useFilesTabs(f.file);
    await tabs.open("a");
    await tabs.open("b", true);
    f.stuck.value = true;
    await tabs.close("b");
    await tabs.open("a");

    expect(tabs.strip.value.tabs.map((tab) => tab.path)).toEqual(["a", "b"]);
    expect(tabs.strip.value.activePath).toBe("b");
  });

  it("changes nothing when the file asked for did not arrive", async () => {
    const f = fakeFile();
    const tabs = useFilesTabs(f.file);
    await tabs.open("a");
    f.failing.add("gone");
    await tabs.open("gone", true);
    await tabs.open("gone");

    expect(tabs.strip.value).toEqual({ tabs: [{ path: "a" }], activePath: "a" });
  });

  it("records where the reader was in the tab being left, and hands it back on return", async () => {
    const f = fakeFile();
    const tabs = useFilesTabs(f.file);
    await tabs.open("a");
    await tabs.open("b", true);
    await tabs.open("a");

    expect(f.loads.at(-1)).toEqual({ path: "a", remembered: { path: "a", showPreview: false, caret: { line: 5, col: 0 } } });
  });

  it("drops a closed front's neighbour too when its file has gone, leaving none in front", async () => {
    const f = fakeFile();
    const tabs = useFilesTabs(f.file);
    await tabs.open("a");
    await tabs.open("b", true);
    await tabs.open("a");
    f.failing.add("b");
    await tabs.close("a");

    expect(tabs.strip.value).toEqual({ tabs: [], activePath: null });
    expect(f.file.openPath.value).toBeNull();
  });

  it("skips a closed front's neighbour whose file has gone for the next one", async () => {
    const f = fakeFile();
    const tabs = useFilesTabs(f.file);
    await tabs.open("a");
    await tabs.open("b", true);
    await tabs.open("c", true);
    await tabs.open("a");
    f.failing.add("b");
    await tabs.close("a");

    expect(tabs.strip.value).toEqual({ tabs: [{ path: "c", showPreview: false, caret: { line: 5, col: 0 } }], activePath: "c" });
    expect(f.file.openPath.value).toBe("c");
  });

  it("lets a file opened during a restore take the front tab's place", async () => {
    const f = fakeFile();
    const tabs = useFilesTabs(f.file);
    await f.file.load("z");
    await tabs.restore({ tabs: [{ path: "a" }, { path: "b" }], activePath: "b" }, () => false);

    expect(tabs.strip.value).toEqual({ tabs: [{ path: "a" }, { path: "z" }], activePath: "z" });
  });

  it("keeps a restore's tabs with none in front when nothing is on screen and it may not open", async () => {
    const f = fakeFile();
    const tabs = useFilesTabs(f.file);
    await tabs.restore({ tabs: [{ path: "a" }], activePath: "a" }, () => false);

    expect(tabs.strip.value).toEqual({ tabs: [{ path: "a" }], activePath: null });
    expect(f.loads).toEqual([]);
  });

  it("closes the front tab from the key, the last one too", async () => {
    const f = fakeFile();
    const tabs = useFilesTabs(f.file);
    await tabs.open("a");
    await tabs.open("b", true);
    await tabs.closeFront();
    expect(tabs.strip.value.tabs.map((tab) => tab.path)).toEqual(["a"]);
    expect(f.file.openPath.value).toBe("a");

    await tabs.closeFront();
    expect(tabs.strip.value).toEqual({ tabs: [], activePath: null });
    expect(f.file.openPath.value).toBeNull();

    await tabs.closeFront(); // nothing in front: nothing to do
    expect(tabs.strip.value).toEqual({ tabs: [], activePath: null });
  });

  it("steps round the tabs from the key", async () => {
    const f = fakeFile();
    const tabs = useFilesTabs(f.file);
    await tabs.open("a");
    await tabs.open("b", true);
    await tabs.open("c", true);
    await tabs.step(1);
    expect(f.file.openPath.value).toBe("a");
    await tabs.step(-1);
    expect(f.file.openPath.value).toBe("c");
    expect(tabs.strip.value.tabs.map((tab) => tab.path)).toEqual(["a", "b", "c"]);
  });

  it("forgets the strip on reset", async () => {
    const f = fakeFile();
    const tabs = useFilesTabs(f.file);
    await tabs.open("a");
    tabs.reset();
    expect(tabs.strip.value).toEqual({ tabs: [], activePath: null });
  });
});

// #3075: a file with no tab and nothing asked of it opens in the view the pane carries.
describe("useFilesTabs — the carried view", () => {
  const carrying = (view: { showPreview: boolean; showCanvas: boolean } | null) => {
    const fake = fakeFile();
    const landed = vi.fn(async () => {});
    const viewFor = vi.fn(() => view);
    return { fake, landed, viewFor, tabs: useFilesTabs(fake.file, { viewFor, landed }) };
  };

  it("hands a carried Preview to the load, and puts nothing up afterwards", async () => {
    const { fake, landed, tabs } = carrying({ showPreview: true, showCanvas: false });
    await tabs.open("a.md");
    expect(fake.loads.at(-1)).toEqual({ path: "a.md", remembered: { path: "a.md", showPreview: true } });
    expect(landed).not.toHaveBeenCalled();
  });

  it("puts the carried Canvas view up only once the file is in front", async () => {
    const { fake, landed, tabs } = carrying({ showPreview: false, showCanvas: true });
    await tabs.open("a.md");
    expect(landed).toHaveBeenCalledWith("a.md");
    fake.failing.add("b.md");
    await tabs.open("b.md");
    expect(landed).toHaveBeenCalledTimes(1);
  });

  it("is not asked when the caller says how the file comes up", async () => {
    const { fake, landed, viewFor, tabs } = carrying({ showPreview: false, showCanvas: true });
    await tabs.open("a.md", false, { path: "a.md", showPreview: false });
    expect(viewFor).not.toHaveBeenCalled();
    expect(landed).not.toHaveBeenCalled();
    expect(fake.loads.at(-1)?.remembered).toEqual({ path: "a.md", showPreview: false });
  });

  it("is not asked for a file that has a tab", async () => {
    const { landed, viewFor, tabs } = carrying({ showPreview: false, showCanvas: true });
    await tabs.open("a.md", true, { path: "a.md" });
    await tabs.open("b.md", true, { path: "b.md" });
    await tabs.open("a.md");
    expect(viewFor).not.toHaveBeenCalled();
    expect(landed).not.toHaveBeenCalled();
  });

  it("opens on the editor when there is nothing to carry", async () => {
    const { fake, tabs } = carrying(null);
    await tabs.open("a.md");
    expect(fake.loads.at(-1)?.remembered).toBeNull();
  });
});
