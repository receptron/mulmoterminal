// The Library's tools kind (#3332): a directory chosen, its instruction files in Claude Code's order,
// each read beside the list.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import type { LibraryInstructions } from "../../../../common/libraryTools";

const file = (scope: string, filePath: string, over: Record<string, unknown> = {}) => ({
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
const reads: string[] = [];
vi.mock("../../../../src/composables/libraryApi", () => ({
  loadToolDirectories: () => Promise.resolve(["/w/app", "/w/lib"]),
  loadInstructions: (cwd: string) => Promise.resolve(listing[cwd] ?? null),
  loadInstruction: (_cwd: string, filePath: string) => (reads.push(filePath), Promise.resolve({ text: `text of ${filePath}` })),
}));

const LibraryTools = (await import("../../../../src/components/library/LibraryTools.vue")).default;

beforeEach(() => {
  reads.length = 0;
  listing = {
    "/w/app": {
      cwd: "/w/app",
      agentsMd: false,
      files: [
        file("user", "/h/.claude/CLAUDE.md"),
        file("directory", "/w/app/CLAUDE.md"),
        file("import", "/w/app/docs/style.md", { importedBy: "/w/app/CLAUDE.md" }),
        file("rule", "/w/app/.claude/rules/api.md", { loads: "on-demand" }),
      ],
    },
    "/w/lib": { cwd: "/w/lib", agentsMd: true, files: [file("agents", "/w/lib/AGENTS.md")] },
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
});
