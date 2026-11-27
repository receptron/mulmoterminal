// The Library's tools kind (#3332): a directory chosen, its instruction files in Claude Code's order,
// each read beside the list.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent, h, ref } from "vue";
import { provideOverlayVisible } from "../../../../src/composables/overlayVisibility";
import { mountUnderOverlay } from "../underOverlay";
import { en } from "../../../../src/i18n/en";
import type { LibraryInstructionFile, LibraryInstructionScope, LibraryInstructions } from "../../../../common/libraryTools";

const file = (scope: LibraryInstructionScope, filePath: string, over: Partial<LibraryInstructionFile> = {}): LibraryInstructionFile => ({
  scope,
  path: filePath,
  loads: "launch",
  importedBy: null,
  lines: 3,
  bytes: 30,
  state: "ok",
  ...over,
});
let listing: Record<string, LibraryInstructions> = {};
/** Answers the next instruction reads take instead of `listing`, one each. */
const instructionsHeld: Promise<LibraryInstructions | null>[] = [];
const reads: string[] = [];
let directoriesAnswer: string[] | null = ["/w/app", "/w/lib"];
let textFails = false;
let textAnswer: { text: string | null; reason?: string; missing?: string[] } | null = null;
vi.mock("../../../../src/composables/libraryApi", () => ({
  loadToolDirectories: () => Promise.resolve(directoriesAnswer),
  loadToolSettings: (cwd: string) =>
    Promise.resolve({
      cwd,
      files: [
        { source: "user", path: "/h/.claude/settings.json", state: "ok" },
        { source: "project", path: `${cwd}/.claude/settings.json`, state: "invalid" },
      ],
      permissions: { allow: [{ value: "Bash(npm test)", source: "user" }], ask: [], deny: [{ value: "Read(.env)", source: "project" }] },
      env: [{ name: "A", value: "1", source: "user" }],
      hooks: [{ event: "Stop", value: "say done", source: "user" }],
      other: [{ key: "model", value: '"opus"', source: "user" }],
    }),
  loadInstructions: (cwd: string) => instructionsHeld.shift() ?? Promise.resolve(listing[cwd] ?? null),
  loadInstruction: (_cwd: string, filePath: string) => (
    reads.push(filePath),
    Promise.resolve(textFails ? null : (textAnswer ?? { text: `text of ${filePath}` }))
  ),
}));

const LibraryTools = (await import("../../../../src/components/library/LibraryTools.vue")).default;

beforeEach(() => {
  reads.length = 0;
  directoriesAnswer = ["/w/app", "/w/lib"];
  textAnswer = null;
  textFails = false;
  listing = {
    "/w/app": {
      cwd: "/w/app",
      agentsMd: false,
      truncated: false,
      files: [
        file("user", "/h/.claude/CLAUDE.md"),
        file("directory", "/w/app/CLAUDE.md"),
        file("import", "/w/app/docs/style.md", { importedBy: "/w/app/CLAUDE.md" }),
        file("rule", "/w/app/.claude/rules/api.md", { loads: "on-demand" }),
      ],
    },
    "/w/lib": { cwd: "/w/lib", agentsMd: true, truncated: false, files: [file("agents", "/w/lib/AGENTS.md")] },
  };
});

const mountTools = async (initialCwd: string | null = null, query = "") => {
  const wrapper = mount(LibraryTools, { props: { query, initialCwd }, attachTo: document.body });
  await flushPromises();
  return wrapper;
};
const rows = (wrapper: Awaited<ReturnType<typeof mountTools>>) => wrapper.findAll("[data-testid=tool-row]").map((row) => row.text());

describe("LibraryTools", () => {
  it("opens on the directory asked for, lists its files in order with how each loads, and reads the first", async () => {
    const wrapper = await mountTools("/w/app");
    expect(rows(wrapper)).toEqual([
      "/h/.claude/CLAUDE.mdYours, every project · 3 lines",
      "CLAUDE.mdDirectory · 3 lines",
      "docs/style.mdImported · 3 lines · imported by CLAUDE.md",
      ".claude/rules/api.mdProject rule · 3 lines · loads only for matching files",
    ]);
    expect(wrapper.find("[data-testid=tool-text]").text()).toBe("text of /h/.claude/CLAUDE.md");
    await wrapper.findAll("[data-testid=tool-row]")[1]?.trigger("click");
    await flushPromises();
    expect(wrapper.find("[data-testid=tool-reader] h2").text()).toBe("/w/app/CLAUDE.md");
    expect(wrapper.find("[data-testid=tool-text]").text()).toBe("text of /w/app/CLAUDE.md");
  });

  it("opens on the first directory when none is asked for, and says when AGENTS.md is read instead", async () => {
    const wrapper = await mountTools(null);
    expect(rows(wrapper)).toHaveLength(4);
    await wrapper.find("[data-testid=library-tools-cwd]").setValue("/w/lib");
    await flushPromises();
    expect(wrapper.find("[data-testid=library-tools-agents]").exists()).toBe(true);
    expect(rows(wrapper)).toEqual(["AGENTS.mdAGENTS.md · 3 lines"]);
  });

  it("narrows to files whose path matches the search, and the arrows move through them", async () => {
    const wrapper = await mountTools("/w/app", "app/");
    expect(rows(wrapper)).toHaveLength(3);
    await (wrapper.vm as unknown as { move(by: number): Promise<void> }).move(1);
    await flushPromises();
    expect(wrapper.find("[data-testid=tool-reader] h2").text()).toBe("/w/app/docs/style.md");
  });

  it("says the directories could not be listed, rather than that there are none", async () => {
    directoriesAnswer = null;
    const wrapper = await mountTools(null);
    expect(wrapper.find("[data-testid=library-tools-directories-failed]").exists()).toBe(true);
    expect(wrapper.find("[data-testid=library-tools-empty]").exists()).toBe(false);
  });

  it("says a file is too large to show, and that a listing stopped at its bound", async () => {
    textAnswer = { text: null, reason: "too-large" };
    listing["/w/app"] = { ...(listing["/w/app"] as LibraryInstructions), truncated: true };
    const wrapper = await mountTools("/w/app");
    expect(wrapper.find("[data-testid=tool-text-missing]").text()).toContain("Too large to show here");
    expect(wrapper.find("[data-testid=library-tools-truncated]").exists()).toBe(true);
  });

  it("follows the conversation selected once it arrives, until a directory is picked by hand", async () => {
    const wrapper = await mountTools(null);
    const chosen = () => wrapper.find<HTMLSelectElement>("[data-testid=library-tools-cwd]").element.value;
    expect(chosen()).toBe("/w/app");
    await wrapper.setProps({ initialCwd: "/w/lib" });
    await flushPromises();
    expect(chosen()).toBe("/w/lib");
    await wrapper.find("[data-testid=library-tools-cwd]").setValue("/w/app");
    await flushPromises();
    await wrapper.setProps({ initialCwd: "/w/lib" });
    await wrapper.setProps({ initialCwd: null });
    await wrapper.setProps({ initialCwd: "/w/lib" });
    await flushPromises();
    expect(chosen()).toBe("/w/app");
  });

  it("says a file over what Claude Code reads is skipped, not that it still loads", async () => {
    textAnswer = { text: null, reason: "too-large" };
    listing["/w/app"] = { cwd: "/w/app", agentsMd: false, truncated: false, files: [file("directory", "/w/app/CLAUDE.md", { state: "too-large" })] };
    const wrapper = await mountTools("/w/app");
    expect(wrapper.find("[data-testid=tool-text-missing]").text()).toBe("over 4 MiB, so Claude Code skips it");
  });

  it("reads the settings laid over each other from the row above the files, each value naming its file", async () => {
    const wrapper = await mountTools("/w/app");
    await wrapper.find("[data-testid=tool-settings-row]").trigger("click");
    await flushPromises();
    expect(wrapper.find("[data-testid=tool-reader]").exists()).toBe(false);
    expect(wrapper.find("[data-testid=tool-settings-files]").text()).toContain("not JSON, skipped");
    expect(wrapper.find("[data-testid=tool-settings-allow]").text()).toBe("Bash(npm test)yours");
    expect(wrapper.find("[data-testid=tool-settings-deny]").text()).toBe("Read(.env)project");
    expect(wrapper.find("[data-testid=tool-settings-env]").text()).toBe("A=1yours");
    expect(wrapper.find("[data-testid=tool-settings-hooks]").text()).toBe("Stopsay doneyours");
    await (wrapper.vm as unknown as { move(by: number): Promise<void> }).move(1);
    await flushPromises();
    expect(wrapper.find("[data-testid=tool-reader] h2").text()).toBe("/h/.claude/CLAUDE.md");
  });

  it("says which paths the file names that are not there", async () => {
    textAnswer = { text: "See `docs/gone.md`.", missing: ["docs/gone.md"] };
    const wrapper = await mountTools("/w/app");
    expect(wrapper.find("[data-testid=tool-missing]").text()).toBe("It names docs/gone.md, which is not there.");
  });

  // The Library is kept while closed: shown again, the directories and the open one's files are read
  // again on the same directory, and a failed re-read keeps what was there.
  it("reads the directories and files again each time the Library is shown, staying on the directory", async () => {
    const visible = ref(true);
    const Host = defineComponent({ setup: () => (provideOverlayVisible(visible), () => h(LibraryTools, { query: "", initialCwd: "/w/lib" })) });
    const wrapper = mount(Host, { attachTo: document.body });
    await flushPromises();
    const showAgain = async () => {
      visible.value = false;
      await flushPromises();
      visible.value = true;
      await flushPromises();
    };
    directoriesAnswer = ["/w/new", "/w/app", "/w/lib"];
    listing["/w/lib"] = {
      cwd: "/w/lib",
      agentsMd: true,
      truncated: false,
      files: [file("agents", "/w/lib/AGENTS.md"), file("rule", "/w/lib/.claude/rules/x.md")],
    };
    await showAgain();
    expect(wrapper.findAll("option").map((option) => option.text())).toEqual(["/w/new", "/w/app", "/w/lib"]);
    expect(wrapper.get<HTMLSelectElement>("[data-testid=library-tools-cwd]").element.value).toBe("/w/lib");
    expect(wrapper.findAll("[data-testid=tool-row]")).toHaveLength(2);
    directoriesAnswer = null;
    listing = {};
    await showAgain();
    expect(wrapper.findAll("[data-testid=tool-row]")).toHaveLength(2);
    expect(wrapper.find("[data-testid=library-tools-directories-failed]").exists()).toBe(false);
    // Nothing else changes now, so only a re-read of the file being read can bring its new text.
    directoriesAnswer = ["/w/new", "/w/app", "/w/lib"];
    textAnswer = { text: "edited while closed" };
    await showAgain();
    expect(wrapper.text()).toContain("edited while closed");
    wrapper.unmount();
  });
});

describe("a first read overtaken by the Library shown again", () => {
  it("says the files could not be read when the re-read fails too", async () => {
    instructionsHeld.push(new Promise(() => {}));
    const { wrapper, showAgain } = mountUnderOverlay(LibraryTools, { query: "", initialCwd: "/w/app" }, { attachTo: document.body });
    await flushPromises();
    listing = {};
    await showAgain();
    expect(wrapper.text()).toContain(en.libraryView.tools.failed);
    wrapper.unmount();
  });
});

describe("the file being read, with its list read again", () => {
  it("keeps its text when the list comes back with the same file and the text read fails", async () => {
    const { wrapper, showAgain } = mountUnderOverlay(LibraryTools, { query: "", initialCwd: "/w/lib" }, { attachTo: document.body });
    await flushPromises();
    expect(wrapper.text()).toContain("text of /w/lib/AGENTS.md");
    listing["/w/lib"] = { cwd: "/w/lib", agentsMd: true, truncated: false, files: [file("agents", "/w/lib/AGENTS.md")] };
    textFails = true;
    await showAgain();
    expect(wrapper.text()).toContain("text of /w/lib/AGENTS.md");
    wrapper.unmount();
  });
});
