import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, flushPromises, type VueWrapper } from "@vue/test-utils";
import FilesPane from "../../../src/components/FilesPane.vue";
import { fakeCmEditor } from "../../helpers/cmEditorDouble";
import { cacheListing } from "../../../src/components/filesTreeCache";

// #3506. A Files pane rooted at a remote cell's directory reads and writes on that host, through the
// gateway, and never asks this server about the remote's paths; a local pane asks this server as before.
let onChange: () => void = () => {};
const fakeEditor = fakeCmEditor("edited text");
const subscribed = vi.hoisted(() => ({ channels: [] as string[] }));
vi.mock("../../../src/composables/usePubSub", () => ({
  usePubSub: () => ({
    subscribe: (channel: string) => {
      subscribed.channels.push(channel);
      return () => {};
    },
    onReconnect: () => () => {},
  }),
}));
vi.mock("../../../src/components/cmEditor", async (orig) => {
  const actual = await orig<typeof import("../../../src/components/cmEditor")>();
  return { ...actual, createEditor: (_host: HTMLElement, cb: () => void) => ((onChange = cb), fakeEditor) };
});

const ROOT = "/srv/proj";
const SEARCH_SETTLED_MS = 250;
const ENTRIES = [
  { name: "src", dir: true, size: 0 },
  { name: "README.md", dir: false, size: 7 },
  { name: "notes.txt", dir: false, size: 5 },
  { name: "pic.png", dir: false, size: 9 },
];

interface Asked {
  method: string;
  url: string;
}

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function answer(route: string, path: string): Response {
  if (route === "list") return json({ entries: path === "" ? ENTRIES : [] });
  if (route === "text" && path.endsWith(".png")) return json({ error: "this file cannot be edited as text", kind: "binary" }, 415);
  if (route === "text") return json({ text: `text of ${path}`, version: "v1" });
  if (route === "index") return json({ paths: ["README.md", "src/a.ts"] });
  if (route === "search") return json({ matches: [{ path: "README.md", line: 1, text: "hello" }] });
  if (route === "lines") return json({ start: 1, lines: ["hello"] });
  if (route === "backups") return json({ backups: [] });
  if (route === "trash") return json({ available: true, ok: true });
  if (route === "create" || route === "rename") return json({ ok: true, path: "src/new.md" });
  return json({ ok: true, version: "v2", files: {} });
}

let asked: Asked[] = [];
function mockFs(): void {
  asked = [];
  globalThis.fetch = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(String(input), "https://x");
    asked.push({ method: init?.method ?? "GET", url: `${url.pathname}${url.search}` });
    return answer(url.pathname.split("/").pop() ?? "", url.searchParams.get("path") ?? "");
  });
}

const rowNamed = (w: VueWrapper, name: string) => w.findAll('[data-testid="files-row"]').find((row) => row.text().includes(name));

const mountOn = (host: string | null) =>
  mount(FilesPane, { props: { cwd: ROOT, host, insertTarget: true, insertTargetCwd: ROOT, canvasTarget: true }, attachTo: document.body });
type Pane = ReturnType<typeof mountOn>;

async function mountPane(host: string | null): Promise<Pane> {
  const w = mountOn(host);
  await flushPromises();
  return w;
}

async function openRow(w: VueWrapper, name: string): Promise<void> {
  await rowNamed(w, name)?.trigger("click");
  await flushPromises();
}

async function rowMenu(w: VueWrapper, name: string): Promise<string[]> {
  rowNamed(w, name)?.element.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 5, clientY: 5 }));
  await flushPromises();
  return [...document.querySelectorAll<HTMLElement>('[data-testid^="files-row-action-"]')].map(
    (el) => el.dataset.testid?.replace("files-row-action-", "") ?? "",
  );
}

async function pick(action: string): Promise<void> {
  document.querySelector<HTMLElement>(`[data-testid="files-row-action-${action}"]`)?.click();
  await flushPromises();
}

/** Everything a pane is driven through: the tree, a read, a save, the row menu's writes, the history,
 *  the finder and the search. */
async function driveEverything(w: Pane): Promise<void> {
  await openRow(w, "README.md");
  onChange();
  await flushPromises();
  await w
    .findAll("button")
    .find((b) => b.text().startsWith("Save"))
    ?.trigger("click");
  await flushPromises();
  await w.find('[data-testid="files-history-btn"]').trigger("click");
  await flushPromises();
  await rowMenu(w, "notes.txt");
  await pick("rename");
  await rowMenu(w, "notes.txt");
  await pick("trash");
  await rowMenu(w, "src");
  await pick("new-file");
  w.vm.openFinder("read");
  await flushPromises();
  w.vm.openSearch("hello");
  // The search waits for typing to settle, and the lines around its match wait again.
  await new Promise((resolve) => setTimeout(resolve, SEARCH_SETTLED_MS));
  await flushPromises();
  await new Promise((resolve) => setTimeout(resolve, SEARCH_SETTLED_MS));
  await flushPromises();
}

const routesAsked = (): string[] => [...new Set(asked.map((request) => `${request.method} ${request.url.split("?")[0]}`))].sort();

describe("the Files pane on a remote cell's host (#3506)", () => {
  beforeEach(() => {
    mockFs();
    subscribed.channels = [];
    vi.spyOn(window, "prompt").mockReturnValue("renamed.txt");
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
    localStorage.clear();
  });

  it("asks the host's gateway for every read and write, and this server for nothing", async () => {
    const w = await mountPane("lx");
    await driveEverything(w);

    expect(routesAsked()).toEqual(
      [
        "GET /remote/lx/api/files/browse/backups",
        "GET /remote/lx/api/files/browse/git-status",
        "GET /remote/lx/api/files/browse/head",
        "GET /remote/lx/api/files/browse/index",
        "GET /remote/lx/api/files/browse/lines",
        "GET /remote/lx/api/files/browse/list",
        "GET /remote/lx/api/files/browse/search",
        "GET /remote/lx/api/files/browse/text",
        "GET /remote/lx/api/files/browse/trash",
        "POST /remote/lx/api/files/browse/create",
        "POST /remote/lx/api/files/browse/rename",
        "POST /remote/lx/api/files/browse/trash",
        "PUT /remote/lx/api/files/browse/write",
      ].sort(),
    );
    expect(asked.every((request) => request.url.includes(`cwd=${encodeURIComponent(ROOT)}`) || request.url === "/remote/lx/api/files/browse/trash")).toBe(true);
  });

  it("asks this server, exactly as before, for a pane on this machine", async () => {
    const w = await mountPane(null);
    await driveEverything(w);

    expect(asked.length).toBeGreaterThan(0);
    expect(asked.every((request) => request.url.startsWith("/api/files/browse/"))).toBe(true);
    expect(routesAsked()).toContain("PUT /api/files/browse/write");
  });

  // What this machine would do with the file: its file manager, its OS, its gallery and Canvas, and
  // a Preview or picture served as bytes, which the gateway does not carry.
  it("offers nothing that acts on this machine or needs the host's bytes", async () => {
    const w = await mountPane("lx");
    expect(await rowMenu(w, "notes.txt")).not.toContain("reveal");
    expect(await rowMenu(w, "src")).not.toContain("open-gallery");

    await openRow(w, "README.md");
    expect(w.find("iframe").attributes("src") ?? "").toBe("");
    expect(w.findAll("button").some((b) => b.text() === "Preview")).toBe(false);

    await openRow(w, "pic.png");
    expect(w.find('[data-testid="files-unpreviewable"]').exists()).toBe(true);
    expect(w.find('[data-testid="files-open-in-os"]').exists()).toBe(false);
    expect(w.html()).not.toMatch(/src="\/api\//);
    expect(await rowMenu(w, "README.md")).not.toContain("open-canvas");
  });

  it("offers the same on this machine (control)", async () => {
    const w = await mountPane(null);
    expect(await rowMenu(w, "notes.txt")).toContain("reveal");
    expect(await rowMenu(w, "src")).toContain("open-gallery");
    expect(await rowMenu(w, "README.md")).toContain("open-canvas");
    await openRow(w, "README.md");
    expect(w.find("iframe").attributes("src")).toContain("/api/files/browse/md?");
    await openRow(w, "pic.png");
    expect(w.html()).toMatch(/src="\/api\/files\/raw\?/);
  });

  // The same path on this machine is another directory: its remembered listing is not the host's.
  it("never paints this machine's listing of the same path", async () => {
    cacheListing(ROOT, [{ name: "ONLY_HERE.md", dir: false, size: 1 }]);
    globalThis.fetch = vi.fn<typeof fetch>(() => new Promise<Response>(() => {}));
    const w = await mountPane("lx");
    expect(w.text()).not.toContain("ONLY_HERE.md");
    w.unmount();
    const local = await mountPane(null);
    expect(local.text()).toContain("ONLY_HERE.md");
  });

  // Joining a file's channel starts a watch on THIS server's disk, at a path from the other machine.
  it("joins no file channel for a remote document", async () => {
    const w = await mountPane("lx");
    await openRow(w, "README.md");
    expect(subscribed.channels.filter((channel) => channel.startsWith("plugin:"))).toEqual([]);
  });

  it("joins the document's channel on this machine (control)", async () => {
    const w = await mountPane(null);
    await openRow(w, "README.md");
    expect(subscribed.channels.some((channel) => channel.startsWith("plugin:"))).toBe(true);
  });
});
