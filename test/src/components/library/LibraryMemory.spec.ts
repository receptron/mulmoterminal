// The Library's memory kind (#3331): grouped by project with the index gauge, read with its links
// followed, and a missing link shown as one.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import type { LibraryMemoryFile, LibraryMemoryHealth, LibraryMemoryProject } from "../../../../common/libraryMemory";

let texts: Record<string, string | null> = {};
vi.mock("../../../../src/composables/libraryApi", () => ({
  loadLibraryMemoryFile: (slug: string, file: string) => {
    const text = texts[`${slug}/${file}`];
    return Promise.resolve(text === undefined ? null : { text, ...(text === null ? {} : { version: "v1" }) });
  },
  saveLibraryMemoryFile: () => Promise.resolve({ kind: "saved", version: "v2" }),
  trashLibraryMemoryFile: (...args: unknown[]) => trashCalls.push(args) && Promise.resolve(trashAnswer),
  undoLibraryMemoryTrash: (undo: string) => undoCalls.push(undo) && Promise.resolve(undoAnswer),
}));
let running = false;
vi.mock("../../../../src/composables/useDirLists", () => ({
  readResumableList: () => Promise.resolve(running ? { sessions: [{ runningKey: "k" }] } : null),
}));
let trashHere = true;
vi.mock("../../../../src/components/treeFileOpsApi", () => ({ trashAvailable: () => Promise.resolve(trashHere) }));
let trashCalls: unknown[][] = [];
let undoCalls: string[] = [];
let trashAnswer: { kind: string; undo?: string } = { kind: "trashed", undo: "u-1" };
let undoAnswer = "restored";

const LibraryMemory = (await import("../../../../src/components/library/LibraryMemory.vue")).default;
const { MEMORY_TRASH_NOTICE_MS } = await import("../../../../src/composables/useMemoryTrash");

const NOW = Date.UTC(2026, 10, 20, 12);
const memory = (file: string, name: string | null, type: string | null = "feedback"): LibraryMemoryFile => ({
  file,
  name,
  description: null,
  type,
  updatedAt: NOW,
});
const projects: LibraryMemoryProject[] = [
  { slug: "-w-app", cwd: "/w/app", index: { lines: 190, bytes: 100 }, files: [memory("reply.md", "reply-in-japanese"), memory("codex.md", "codex-sandbox")] },
  { slug: "-w-lib", cwd: null, index: { lines: 3, bytes: 100 }, files: [memory("lib.md", null, null)] },
];

beforeEach(() => {
  vi.useRealTimers();
  running = false;
  trashHere = true;
  trashCalls = [];
  undoCalls = [];
  trashAnswer = { kind: "trashed", undo: "u-1" };
  undoAnswer = "restored";
  texts = {
    "-w-app/reply.md": "---\nname: reply-in-japanese\n---\nAlways Japanese. See [[codex-sandbox]] and [[gone]].",
    "-w-app/codex.md": "---\nname: codex-sandbox\n---\nThe sandbox refuses rm.",
    "-w-lib/lib.md": "no frontmatter",
  };
});

const mountMemory = async (query = "", health: ReadonlyMap<string, LibraryMemoryHealth> = new Map()) => {
  const wrapper = mount(LibraryMemory, { props: { projects, loaded: true, failed: false, query, now: NOW, health }, attachTo: document.body });
  await flushPromises();
  return wrapper;
};

describe("LibraryMemory", () => {
  it("groups by project, named by its directory or else its folder, with the index gauge warning past nine tenths", async () => {
    const wrapper = await mountMemory();
    expect(wrapper.findAll("h3").map((heading) => heading.text())).toEqual(["appMEMORY.md 190 / 200 lines", "-w-libMEMORY.md 3 / 200 lines"]);
    expect(wrapper.findAll("[data-testid=memory-index-fill]").map((gauge) => gauge.classes().includes("text-warn"))).toEqual([true, false]);
  });

  it("names the byte limit when an index is nearer to it than to the line limit", async () => {
    const heavy: LibraryMemoryProject[] = [{ slug: "-w-heavy", cwd: "/w/heavy", index: { lines: 10, bytes: 30_000 }, files: [memory("h.md", "h")] }];
    const wrapper = mount(LibraryMemory, { props: { projects: heavy, loaded: true, failed: false, query: "", now: NOW, health: new Map() } });
    await flushPromises();
    const gauge = wrapper.find("[data-testid=memory-index-fill]");
    expect(gauge.text()).toBe("MEMORY.md 30.0 / 25.0 KB");
    expect(gauge.classes()).toContain("text-warn");
  });

  it("reads the first memory's body, follows a link to another, and shows a missing one as unusable", async () => {
    const wrapper = await mountMemory();
    expect(wrapper.find("[data-testid=memory-body]").text()).toContain("Always Japanese.");
    const links = wrapper.findAll("[data-testid=memory-body] span[data-page]");
    expect(links.map((link) => [link.attributes("data-page"), link.attributes("aria-disabled") === "true"])).toEqual([
      ["codex-sandbox", false],
      ["gone", true],
    ]);
    await links[1]?.trigger("click"); // names nothing: stays put
    expect(wrapper.find("[data-testid=memory-reader] h2").text()).toBe("reply-in-japanese");
    await links[0]?.trigger("click");
    await flushPromises();
    expect(wrapper.find("[data-testid=memory-reader] h2").text()).toBe("codex-sandbox");
    expect(wrapper.find("[data-testid=memory-body]").text()).toBe("The sandbox refuses rm.");
  });

  it("renders the body as Markdown with the frontmatter left out, and follows a link from the keyboard", async () => {
    texts["-w-app/reply.md"] = "---\nname: reply-in-japanese\n---\n**Why:** wrapped\nmid sentence. [[codex-sandbox]]\n\n<script>alert(1)</script>";
    const wrapper = await mountMemory();
    const body = wrapper.find("[data-testid=memory-body]");
    expect(body.find("strong").text()).toBe("Why:");
    expect(body.text()).not.toContain("name: reply-in-japanese");
    expect(body.find("script").exists()).toBe(false);
    await body.find("span[data-page]").trigger("keydown", { key: "Enter" });
    await flushPromises();
    expect(wrapper.find("[data-testid=memory-reader] h2").text()).toBe("codex-sandbox");
  });

  it("leaves the frontmatter out of the body when the file ends at its closing line", async () => {
    texts["-w-app/reply.md"] = "---\nname: reply-in-japanese\ndescription: hidden\n---";
    const wrapper = await mountMemory();
    expect(wrapper.find("[data-testid=memory-body]").text()).toBe("");
  });

  it("shows an image in a memory as its alt text, fetching nothing", async () => {
    texts["-w-app/reply.md"] = "---\nname: reply-in-japanese\n---\nsee ![the secret](/.env) here";
    const wrapper = await mountMemory();
    const body = wrapper.find("[data-testid=memory-body]");
    expect(body.find("img").exists()).toBe(false);
    expect(body.text()).toContain("see the secret here");
  });

  it("narrows to what the search matches, and says when nothing does", async () => {
    expect((await mountMemory("codex")).findAll("[data-testid=memory-row]").map((row) => row.text())).toEqual([expect.stringContaining("codex-sandbox")]);
    expect((await mountMemory("zzz")).find("[data-testid=memory-no-match]").exists()).toBe(true);
  });

  it("moves through the memories in list order, across projects", async () => {
    const wrapper = await mountMemory();
    const vm = wrapper.vm as unknown as { move(by: number): Promise<void> };
    await vm.move(1);
    await vm.move(1);
    await flushPromises();
    expect(wrapper.find("[data-testid=memory-reader] h2").text()).toBe("lib");
  });

  it("reads the chosen memory again when the list is read again, as on reopening", async () => {
    const wrapper = await mountMemory();
    expect(wrapper.find("[data-testid=memory-body]").text()).toContain("Always Japanese.");
    texts["-w-app/reply.md"] = "---\nname: reply-in-japanese\n---\nRewritten while the Library was closed.";
    await wrapper.setProps({ projects: projects.map((project) => ({ ...project })) });
    await flushPromises();
    expect(wrapper.find("[data-testid=memory-body]").text()).toBe("Rewritten while the Library was closed.");
  });

  it("says a memory could not be read rather than showing it empty", async () => {
    texts["-w-app/reply.md"] = null;
    const wrapper = await mountMemory();
    expect(wrapper.find("[data-testid=memory-body]").exists()).toBe(false);
    expect(wrapper.find("[data-testid=memory-reader]").text()).toContain("This memory could not be read.");
  });

  it("says how much can be tidied, marks those rows, and narrows to them on Show", async () => {
    const health = new Map<string, LibraryMemoryHealth>([
      ["-w-app", { slug: "-w-app", issues: [], files: { "codex.md": [{ kind: "broken-link", names: ["gone"] }] } }],
      ["-w-lib", { slug: "-w-lib", issues: [{ kind: "no-index" }], files: {} }],
    ]);
    const wrapper = await mountMemory("", health);
    expect(wrapper.find("[data-testid=memory-tidy]").text()).toContain("2 can be tidied");
    expect(wrapper.findAll("[data-testid=memory-row]").map((row) => row.find("[data-testid=memory-row-dot]").exists())).toEqual([false, true, false]);
    expect(wrapper.find("[data-testid=memory-project-issue]").text()).toBe("No MEMORY.md, so Claude Code is not told about these memories.");
    await wrapper.find("[data-testid=memory-tidy-toggle]").trigger("click");
    expect(wrapper.findAll("[data-testid=memory-row]").map((row) => row.text())).toEqual([expect.stringContaining("codex-sandbox")]);
    expect(wrapper.findAll("h3")).toHaveLength(2); // the project with an index issue keeps its heading
    await wrapper.find("[data-testid=memory-row]").trigger("click");
    await flushPromises();
    expect(wrapper.find("[data-testid=memory-issue]").text()).toBe("It links to [[gone]], but no memory here has that name.");
  });

  it("keeps a project whose only issue is its index when narrowed, rather than saying nothing matches", async () => {
    const health = new Map<string, LibraryMemoryHealth>([["-w-lib", { slug: "-w-lib", issues: [{ kind: "index-over-limit" }], files: {} }]]);
    const wrapper = await mountMemory("", health);
    await wrapper.find("[data-testid=memory-tidy-toggle]").trigger("click");
    expect(wrapper.find("[data-testid=memory-no-match]").exists()).toBe(false);
    expect(wrapper.find("[data-testid=memory-project-issue]").text()).toContain("MEMORY.md is longer than Claude Code loads");
  });

  it("shows no tidy line when there is nothing to tidy", async () => {
    expect((await mountMemory()).find("[data-testid=memory-tidy]").exists()).toBe(false);
  });

  it("says the check failed rather than looking as if all were tidy", async () => {
    const wrapper = mount(LibraryMemory, { props: { projects, loaded: true, failed: false, query: "", now: NOW, health: new Map(), healthFailed: true } });
    await flushPromises();
    expect(wrapper.find("[data-testid=memory-health-failed]").text()).toBe("Could not check what can be tidied.");
  });

  it("moves to a shown memory when narrowing hides the one being read, and stays there when widened", async () => {
    const health = new Map<string, LibraryMemoryHealth>([["-w-app", { slug: "-w-app", issues: [], files: { "codex.md": [{ kind: "not-in-index" }] } }]]);
    const wrapper = await mountMemory("", health);
    expect(wrapper.find("[data-testid=memory-reader] h2").text()).toBe("reply-in-japanese");
    await wrapper.find("[data-testid=memory-tidy-toggle]").trigger("click");
    await flushPromises();
    expect(wrapper.find("[data-testid=memory-reader] h2").text()).toBe("codex-sandbox");
    expect(wrapper.find("[data-testid=memory-row][aria-current=true]").text()).toContain("codex-sandbox");
    await wrapper.find("[data-testid=memory-tidy-toggle]").trigger("click");
    await flushPromises();
    expect(wrapper.find("[data-testid=memory-reader] h2").text()).toBe("codex-sandbox");
  });

  it("starts unnarrowed when the list is read again, as on reopening", async () => {
    const health = new Map<string, LibraryMemoryHealth>([["-w-app", { slug: "-w-app", issues: [], files: { "codex.md": [{ kind: "not-in-index" }] } }]]);
    const wrapper = await mountMemory("", health);
    await wrapper.find("[data-testid=memory-tidy-toggle]").trigger("click");
    expect(wrapper.findAll("[data-testid=memory-row]")).toHaveLength(1);
    await wrapper.setProps({ projects: projects.map((project) => ({ ...project })) });
    expect(wrapper.findAll("[data-testid=memory-row]")).toHaveLength(3);
  });

  it("edits in place: Edit opens the editor, a save shows the new text and says the list changed", async () => {
    const wrapper = await mountMemory();
    await wrapper.find("[data-testid=memory-edit]").trigger("click");
    await flushPromises();
    await wrapper.find("[data-testid=memory-editor-field]").setValue("---\nname: reply-in-japanese\n---\nEdited here.");
    await wrapper.find("[data-testid=memory-editor-save]").trigger("click");
    await flushPromises();
    expect(wrapper.find("[data-testid=memory-editor]").exists()).toBe(false);
    expect(wrapper.find("[data-testid=memory-body]").text()).toBe("Edited here.");
    expect(wrapper.emitted("changed")).toHaveLength(1);
  });

  it("offers no editing for a memory that could not be read", async () => {
    texts["-w-app/reply.md"] = null;
    const wrapper = await mountMemory();
    expect(wrapper.find("[data-testid=memory-edit]").exists()).toBe(false);
  });

  it("keeps an unsaved edit: another memory is not chosen until it is saved or cancelled", async () => {
    const wrapper = await mountMemory();
    await wrapper.find("[data-testid=memory-edit]").trigger("click");
    await flushPromises();
    await wrapper.find("[data-testid=memory-editor-field]").setValue("a draft I have not saved");
    await wrapper.findAll("[data-testid=memory-row]")[1]?.trigger("click");
    await flushPromises();
    expect(wrapper.find("[data-testid=memory-reader] h2").text()).toBe("reply-in-japanese");
    expect((wrapper.find("[data-testid=memory-editor-field]").element as HTMLTextAreaElement).value).toBe("a draft I have not saved");
    expect(wrapper.find("[data-testid=memory-editor-notice]").text()).toBe("Save or cancel this edit first.");
    await wrapper.find("[data-testid=memory-editor-cancel]").trigger("click");
    await wrapper.findAll("[data-testid=memory-row]")[1]?.trigger("click");
    await flushPromises();
    expect(wrapper.find("[data-testid=memory-reader] h2").text()).toBe("codex-sandbox");
  });

  describe("moving a memory to the Trash", () => {
    const trashFirst = async (wrapper: Awaited<ReturnType<typeof mountMemory>>) => {
      await wrapper.find("[data-testid=library-more-actions]").trigger("click");
      await wrapper.find("[data-testid=memory-trash]").trigger("click");
      await flushPromises();
    };
    const title = (wrapper: Awaited<ReturnType<typeof mountMemory>>) => wrapper.find("[data-testid=memory-reader] h2").text();

    it("moves the memory read, on its version, says so with Undo, and reads the next one", async () => {
      const wrapper = await mountMemory();
      await trashFirst(wrapper);
      expect(trashCalls).toEqual([["-w-app", "reply.md", "v1"]]);
      expect(wrapper.emitted("changed")).toHaveLength(1);
      expect(wrapper.find("[data-testid=memory-trash-notice]").text()).toContain("Moved “reply-in-japanese” to the Trash.");
      expect(title(wrapper)).toBe("codex-sandbox");
      await wrapper.find("[data-testid=memory-trash-undo]").trigger("click");
      await flushPromises();
      expect(undoCalls).toEqual(["u-1"]);
      expect(wrapper.emitted("changed")).toHaveLength(2);
      expect(title(wrapper)).toBe("reply-in-japanese");
      expect(wrapper.find("[data-testid=memory-trash-notice]").exists()).toBe(false);
    });

    it("reads the previous memory when the last one in the list went", async () => {
      const wrapper = await mountMemory();
      await wrapper.findAll("[data-testid=memory-row]")[2]?.trigger("click");
      await flushPromises();
      await trashFirst(wrapper);
      expect(trashCalls[0]?.[1]).toBe("lib.md");
      expect(title(wrapper)).toBe("codex-sandbox");
    });

    it("adds that a session is running in the project, as editing does", async () => {
      running = true;
      const wrapper = await mountMemory();
      await trashFirst(wrapper);
      expect(wrapper.find("[data-testid=memory-trash-notice]").text()).toContain("A session is running in this project");
    });

    it("leaves a memory changed since it was read, says so, and reads it again", async () => {
      trashAnswer = { kind: "changed" };
      const wrapper = await mountMemory();
      texts["-w-app/reply.md"] = "---\nname: reply-in-japanese\n---\nThe agent's newer text.";
      await trashFirst(wrapper);
      expect(wrapper.find("[data-testid=memory-trash-notice]").text()).toContain("changed since it was opened");
      expect(wrapper.find("[data-testid=memory-trash-undo]").exists()).toBe(false);
      expect(wrapper.emitted("changed")).toBeUndefined();
      expect(title(wrapper)).toBe("reply-in-japanese");
      expect(wrapper.find("[data-testid=memory-body]").text()).toBe("The agent's newer text.");
    });

    it("says why an undo did not put it back", async () => {
      undoAnswer = "taken";
      const wrapper = await mountMemory();
      await trashFirst(wrapper);
      await wrapper.find("[data-testid=memory-trash-undo]").trigger("click");
      await flushPromises();
      expect(wrapper.find("[data-testid=memory-trash-notice]").text()).toContain("stays in the Trash");
      expect(title(wrapper)).toBe("codex-sandbox");
    });

    it("keeps Undo after an undo that failed, and puts it back on a second try", async () => {
      undoAnswer = "failed";
      const wrapper = await mountMemory();
      await trashFirst(wrapper);
      await wrapper.find("[data-testid=memory-trash-undo]").trigger("click");
      await flushPromises();
      expect(wrapper.find("[data-testid=memory-trash-notice]").text()).toContain("could not be put back");
      undoAnswer = "restored";
      await wrapper.find("[data-testid=memory-trash-undo]").trigger("click");
      await flushPromises();
      expect(undoCalls).toEqual(["u-1", "u-1"]);
      expect(title(wrapper)).toBe("reply-in-japanese");
    });

    it("lets the notice go after a while", async () => {
      const wrapper = await mountMemory();
      vi.useFakeTimers();
      await trashFirst(wrapper);
      expect(wrapper.find("[data-testid=memory-trash-notice]").exists()).toBe(true);
      vi.advanceTimersByTime(MEMORY_TRASH_NOTICE_MS);
      await flushPromises();
      expect(wrapper.find("[data-testid=memory-trash-notice]").exists()).toBe(false);
    });

    it("offers no Trash where the system has none", async () => {
      trashHere = false;
      const wrapper = await mountMemory();
      expect(wrapper.find("[data-testid=library-more-actions]").exists()).toBe(false);
    });
  });
});
