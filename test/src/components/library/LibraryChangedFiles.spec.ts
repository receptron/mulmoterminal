// The changed-files strip in the reader (#3330): hidden with nothing to show, a diff of the chosen
// step once opened, and a reason in place of a diff it cannot draw.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { mountUnderOverlay } from "../underOverlay";
import type { LibraryConversation } from "../../../../common/library";
import type { LibraryFileText, LibraryTrackedFile } from "../../../../common/libraryFiles";

let files: LibraryTrackedFile[] | null = [];
let texts: Record<string, LibraryFileText> = {};
const asked: string[] = [];
let textGate: Promise<void> = Promise.resolve();
vi.mock("../../../../src/composables/libraryApi", () => ({
  loadLibraryFiles: () => Promise.resolve(files),
  loadLibraryFileText: async (_id: string, _cwd: string | null, file: string, version: number | "now") => {
    asked.push(`${file}@${String(version)}`);
    await textGate;
    return texts[`${file}@${String(version)}`] ?? null;
  },
}));
const drawn: [string, string][] = [];
vi.mock("../../../../src/components/cmDiffView", () => ({
  createDiffView: (_host: HTMLElement, original: string, current: string) => (drawn.push([original, current]), { destroy: () => {} }),
}));

const LibraryChangedFiles = (await import("../../../../src/components/library/LibraryChangedFiles.vue")).default;

const conversation: LibraryConversation = {
  ...{ id: "s1", agent: "claude", title: "T", cwd: "/w/app", gitBranch: null, prs: [], costUsd: null, linesAdded: null, linesRemoved: null },
  ...{ startedAt: null, endedAt: null, skills: [], hookErrors: 0, userTurns: 1, isSidechain: false, parentId: null, isTemporary: false, entrypoint: "cli" },
};
const tracked = (trackingPath: string, versions: [number, boolean][]): LibraryTrackedFile => ({
  trackingPath,
  path: `/w/app/${trackingPath}`,
  versions: versions.map(([version, exists]) => ({ version, at: null, exists })),
});

beforeEach(() => {
  files = [];
  texts = {};
  asked.length = 0;
  drawn.length = 0;
  textGate = Promise.resolve();
});

async function opened() {
  const wrapper = mount(LibraryChangedFiles, { props: { conversation }, attachTo: document.body });
  await flushPromises();
  await wrapper.find("[data-testid=library-files-toggle]").trigger("click");
  await flushPromises();
  return wrapper;
}

describe("LibraryChangedFiles", () => {
  it("shows nothing for a conversation that changed no files, or whose files could not be read", async () => {
    expect(mount(LibraryChangedFiles, { props: { conversation } }).find("[data-testid=library-files]").exists()).toBe(false);
    files = null;
    const failed = mount(LibraryChangedFiles, { props: { conversation } });
    await flushPromises();
    expect(failed.find("[data-testid=library-files]").exists()).toBe(false);
  });

  it("draws the whole change of the first file once opened, then one turn's when chosen", async () => {
    files = [
      tracked("src/a.ts", [
        [1, true],
        [2, true],
      ]),
    ];
    texts = { "src/a.ts@1": { text: "one" }, "src/a.ts@2": { text: "two" }, "src/a.ts@now": { text: "three" } };
    const wrapper = await opened();
    expect(wrapper.find("[data-testid=library-files-toggle]").text()).toContain("1");
    expect(drawn.at(-1)).toEqual(["one", "three"]);
    const steps = wrapper.findAll("[data-testid=library-file-step]");
    expect(steps.map((button) => button.text())).toEqual(["Whole conversation", "v1 → v2", "v2 → now"]);
    await steps[1]?.trigger("click");
    await flushPromises();
    expect(drawn.at(-1)).toEqual(["one", "two"]);
  });

  it("does not read a version before the strip is opened", async () => {
    files = [tracked("src/a.ts", [[1, true]])];
    mount(LibraryChangedFiles, { props: { conversation } });
    await flushPromises();
    expect(asked).toEqual([]);
  });

  it("draws a file the conversation created against nothing", async () => {
    files = [tracked("new.md", [[1, false]])];
    texts = { "new.md@1": { text: null, reason: "absent" }, "new.md@now": { text: "made here" } };
    await opened();
    expect(drawn.at(-1)).toEqual(["", "made here"]);
  });

  it("says why instead of drawing a side too large, binary or unreadable", async () => {
    files = [tracked("big.bin", [[1, true]])];
    texts = { "big.bin@1": { text: null, reason: "binary" }, "big.bin@now": { text: "x" } };
    const wrapper = await opened();
    expect(wrapper.find("[data-testid=library-file-blocked]").text()).toBe("Not a text file.");
    expect(drawn).toEqual([]);
  });
});

// The reader is kept while the Library is closed, and the conversation may have gone on changing files.
describe("the changed files shown again", () => {
  it("are read again, staying on the file shown, and kept through a failed read", async () => {
    files = [tracked("a.md", [[1, true]])];
    const { wrapper, showAgain } = mountUnderOverlay(LibraryChangedFiles, { conversation }, { attachTo: document.body });
    await flushPromises();
    await wrapper.find("[data-testid=library-files-toggle]").trigger("click");
    await flushPromises();
    files = [tracked("b.md", [[1, true]]), tracked("a.md", [[1, true]])];
    await showAgain();
    expect(wrapper.findAll("[data-testid=library-file]").map((row) => row.text())).toEqual(["b.md", "a.md"]);
    expect(wrapper.get("[data-testid=library-file][aria-current=true]").text()).toBe("a.md");
    files = null;
    await showAgain();
    expect(wrapper.findAll("[data-testid=library-file]")).toHaveLength(2);
    wrapper.unmount();
  });
});

describe("a diff being read when the Library is shown again", () => {
  it("is still drawn when the list's re-read fails", async () => {
    files = [tracked("a.md", [[1, true]])];
    texts = { "a.md@1": { text: "one" }, "a.md@now": { text: "two" } };
    const { wrapper, showAgain } = mountUnderOverlay(LibraryChangedFiles, { conversation }, { attachTo: document.body });
    await flushPromises();
    let release: () => void = () => {};
    textGate = new Promise((resolve) => (release = resolve));
    await wrapper.find("[data-testid=library-files-toggle]").trigger("click");
    await flushPromises();
    files = null;
    await showAgain();
    release();
    await flushPromises();
    expect(drawn.length).toBeGreaterThan(0);
    wrapper.unmount();
  });
});
