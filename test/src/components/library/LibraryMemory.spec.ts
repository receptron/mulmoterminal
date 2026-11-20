// The Library's memory kind (#3331): grouped by project with the index gauge, read with its links
// followed, and a missing link shown as one.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import type { LibraryMemoryFile, LibraryMemoryProject } from "../../../../common/libraryMemory";

let texts: Record<string, string | null> = {};
vi.mock("../../../../src/composables/libraryApi", () => ({
  loadLibraryMemoryFile: (slug: string, file: string) => {
    const text = texts[`${slug}/${file}`];
    return Promise.resolve(text === undefined ? null : { text });
  },
}));

const LibraryMemory = (await import("../../../../src/components/library/LibraryMemory.vue")).default;

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
  texts = {
    "-w-app/reply.md": "---\nname: reply-in-japanese\n---\nAlways Japanese. See [[codex-sandbox]] and [[gone]].",
    "-w-app/codex.md": "---\nname: codex-sandbox\n---\nThe sandbox refuses rm.",
    "-w-lib/lib.md": "no frontmatter",
  };
});

const mountMemory = async (query = "") => {
  const wrapper = mount(LibraryMemory, { props: { projects, loaded: true, failed: false, query, now: NOW }, attachTo: document.body });
  await flushPromises();
  return wrapper;
};

describe("LibraryMemory", () => {
  it("groups by project, named by its directory or else its folder, with the index gauge warning past nine tenths", async () => {
    const wrapper = await mountMemory();
    expect(wrapper.findAll("h3").map((heading) => heading.text())).toEqual(["appMEMORY.md 190 / 200 lines", "-w-libMEMORY.md 3 / 200 lines"]);
    expect(wrapper.findAll("[data-testid=memory-index-fill]").map((gauge) => gauge.classes().includes("text-warn"))).toEqual([true, false]);
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

  it("says a memory could not be read rather than showing it empty", async () => {
    texts["-w-app/reply.md"] = null;
    const wrapper = await mountMemory();
    expect(wrapper.find("[data-testid=memory-body]").exists()).toBe(false);
    expect(wrapper.find("[data-testid=memory-reader]").text()).toContain("This memory could not be read.");
  });
});
