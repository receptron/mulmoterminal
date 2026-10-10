import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import FilesPane from "../../../src/components/FilesPane.vue";
import { fakeCmEditor } from "../../helpers/cmEditorDouble";

// The header holds every control the pane has, and with a Markdown file open that is more than a
// split-width pane is wide. A row that cannot wrap then overflows past the pane's right edge, and
// the last thing on it — the close button — is the first to leave the window (#2983). jsdom lays
// nothing out, so this pins the shape the real-app check relied on: a wrapping row, with the close
// button on it.

const fakeEditor = fakeCmEditor("");
vi.mock("../../../src/composables/usePubSub", () => ({
  usePubSub: () => ({ subscribe: () => () => {}, onReconnect: () => () => {} }),
}));
vi.mock("../../../src/components/cmEditor", async (orig) => {
  const actual = await orig<typeof import("../../../src/components/cmEditor")>();
  return { ...actual, createEditor: () => fakeEditor };
});

const realFetch = globalThis.fetch;
beforeEach(() => {
  localStorage.clear();
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), "http://localhost");
    if (url.pathname.endsWith("/index")) return { ok: true, status: 200, json: async () => ({ paths: ["README.md"], truncated: false, source: "git" }) };
    if (url.pathname.endsWith("/list")) return { ok: true, status: 200, json: async () => ({ entries: [{ name: "README.md", dir: false, size: 3 }] }) };
    if (url.pathname.endsWith("/text")) return { ok: true, status: 200, json: async () => ({ text: "# hi", version: "v1" }) };
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  }) as unknown as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
  document.body.innerHTML = "";
});

describe("the Files pane header", () => {
  it("is a wrapping row that keeps its close button, so a narrow pane cannot push it off screen", async () => {
    const w = mount(FilesPane, { props: { cwd: "/proj", canvasTarget: true, insertTarget: true, insertTargetCwd: "/proj" }, attachTo: document.body });
    await flushPromises();
    await w.find('[data-testid="files-row"][data-path="README.md"]').trigger("click");
    await flushPromises();

    const header = w.find("header");
    expect(header.classes()).toContain("flex-wrap");
    expect(header.find('button[aria-label="Close files"]').exists()).toBe(true);
    // A Markdown file is the fullest row the header has — the case that overflowed.
    expect(header.findAll("button").length).toBeGreaterThan(8);
    w.unmount();
  });
});
