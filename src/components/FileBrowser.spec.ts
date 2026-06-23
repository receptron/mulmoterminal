import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import FileBrowser from "./FileBrowser.vue";

type Entry = { name: string; dir: boolean; size: number };

// /api/files/browse/list returns entries for the requested dir; route by the `path`
// query so folder navigation can return a different listing.
function mockList(byPath: Record<string, Entry[]>) {
  globalThis.fetch = vi.fn(async (url: string) => {
    const u = new URL(String(url), "https://x");
    const p = u.searchParams.get("path") ?? "";
    return { ok: true, json: async () => ({ entries: byPath[p] ?? [] }) };
  }) as unknown as typeof fetch;
}

const ROOT: Entry[] = [
  { name: "src", dir: true, size: 0 },
  { name: "README.md", dir: false, size: 10 },
  { name: "logo.png", dir: false, size: 20 },
];

const openMenu = async (w: ReturnType<typeof mount>) => {
  await w.find(".file-trigger").trigger("click");
  await flushPromises();
};

describe("FileBrowser", () => {
  beforeEach(() => mockList({ "": ROOT, src: [{ name: "App.vue", dir: false, size: 5 }] }));

  it("renders nothing when there is no resolved project cwd", () => {
    const w = mount(FileBrowser, { props: { cwd: null } });
    expect(w.find(".file-menu").exists()).toBe(false);
  });

  it("lists the project root when opened (dirs and files)", async () => {
    const w = mount(FileBrowser, { props: { cwd: "/proj" } });
    await openMenu(w);
    const names = w.findAll(".file-item").map((b) => b.find(".file-name").text());
    expect(names).toEqual(["src", "README.md", "logo.png"]);
  });

  it("navigates into a folder and back up", async () => {
    const w = mount(FileBrowser, { props: { cwd: "/proj" } });
    await openMenu(w);
    await w.findAll(".file-item")[0].trigger("click"); // src/
    await flushPromises();
    expect(w.find(".file-path").text()).toBe("src");
    expect(w.findAll(".file-item").map((b) => b.find(".file-name").text())).toEqual(["App.vue"]);
    await w.find(".file-up").trigger("click");
    await flushPromises();
    expect(w.find(".file-path").text()).toBe("/");
  });

  it("opens markdown via the md route and other files raw, in a new tab", async () => {
    const openSpy = vi.fn();
    vi.stubGlobal("open", openSpy);
    const w = mount(FileBrowser, { props: { cwd: "/proj" } });
    await openMenu(w);
    const items = w.findAll(".file-item");
    await items[1].trigger("click"); // README.md
    await items[2].trigger("click"); // logo.png
    expect(openSpy.mock.calls[0][0]).toContain("/api/files/browse/md?cwd=%2Fproj&path=README.md");
    expect(openSpy.mock.calls[1][0]).toContain("/api/files/browse/raw?cwd=%2Fproj&path=logo.png");
    vi.unstubAllGlobals();
  });
});
