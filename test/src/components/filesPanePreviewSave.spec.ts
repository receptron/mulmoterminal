import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import FilesPane from "../../../src/components/FilesPane.vue";
import { fakeCmEditor } from "../../helpers/cmEditorDouble";

// #2262. Preview renders the file ON DISK, so switching to it with unsaved edits showed the old
// text. Switching saves first — the pane already saves without asking whenever it is left, and
// this is the same promise for the other view of the same file.
let onChange: () => void = () => {};
const fakeEditor = fakeCmEditor("edited text");
vi.mock("../../../src/composables/usePubSub", () => ({
  usePubSub: () => ({ subscribe: () => () => {}, onReconnect: () => () => {} }),
}));
vi.mock("../../../src/components/cmEditor", async (orig) => {
  const actual = await orig<typeof import("../../../src/components/cmEditor")>();
  return { ...actual, createEditor: (_host: HTMLElement, cb: () => void) => ((onChange = cb), fakeEditor) };
});

type WriteReply = () => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;
const saved: WriteReply = async () => ({ ok: true, status: 200, json: async () => ({ ok: true, version: "v2" }) });
let writeReply: WriteReply = saved;

function mockFs() {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/list"))
      return {
        ok: true,
        json: async () => ({
          entries: [
            { name: "README.md", dir: false, size: 10 },
            { name: "OTHER.md", dir: false, size: 10 },
          ],
        }),
      };
    // Each file has a version of its own, so a result that lands on the wrong one is visible.
    if (url.includes("/text")) return { ok: true, json: async () => ({ text: "# hello", version: url.includes("OTHER.md") ? "o1" : "v1" }) };
    if (url.includes("/write")) return writeReply();
    return { ok: true, json: async () => ({ ok: true }) };
  }) as unknown as typeof fetch;
}

const fetchCalls = () => (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls;
const calls = () => fetchCalls().map((c) => String(c[0]));
/** The `baseVersion` the most recent write claimed to be editing. */
const lastWriteBase = (): unknown => {
  const init: unknown = fetchCalls()
    .filter((c) => String(c[0]).includes("/write"))
    .at(-1)?.[1];
  const body = typeof init === "object" && init !== null && "body" in init && typeof init.body === "string" ? init.body : "{}";
  const parsed: unknown = JSON.parse(body);
  return typeof parsed === "object" && parsed !== null && "baseVersion" in parsed ? parsed.baseVersion : undefined;
};
const writes = () => calls().filter((url) => url.includes("/write"));
const modeButton = (w: ReturnType<typeof mount>) => w.findAll("button").find((b) => b.text() === "Preview" || b.text() === "Edit");
const inPreview = (w: ReturnType<typeof mount>) => !(w.find("iframe").attributes("style") ?? "").includes("display: none");
const previewVersion = (w: ReturnType<typeof mount>) => new URLSearchParams((w.find("iframe").attributes("src") ?? "").split("?")[1] ?? "").get("v");

async function openReadme(edit: boolean) {
  const w = mount(FilesPane, { props: { cwd: "/proj" } });
  await flushPromises();
  await w.findAll('[data-testid="files-row"]')[0].trigger("click");
  await flushPromises();
  if (edit) onChange();
  await flushPromises();
  return w;
}

describe("switching to Preview with unsaved edits", () => {
  beforeEach(() => {
    writeReply = saved;
    mockFs();
  });

  it("saves first, and previews the version it saved", async () => {
    const w = await openReadme(true);
    await modeButton(w)?.trigger("click");
    await flushPromises();

    expect(writes()).toHaveLength(1);
    expect(inPreview(w)).toBe(true);
    expect(previewVersion(w)).toBe("v2");
    expect(w.text()).not.toContain("●"); // no longer unsaved
  });

  it("does not write when there is nothing unsaved", async () => {
    const w = await openReadme(false);
    await modeButton(w)?.trigger("click");
    await flushPromises();

    expect(writes()).toEqual([]);
    expect(inPreview(w)).toBe(true);
    expect(previewVersion(w)).toBe("v1");
  });

  // The file moved on under the buffer. Nothing was written, so a preview would show neither the
  // edits nor anything the reader chose — the banner that asks is where they belong.
  it("stays in the editor with the conflict banner when the save loses the race", async () => {
    writeReply = async () => ({ ok: false, status: 409, json: async () => ({ error: "conflict", version: "v9" }) });
    const w = await openReadme(true);
    await modeButton(w)?.trigger("click");
    await flushPromises();

    expect(inPreview(w)).toBe(false);
    expect(w.find('[data-testid="files-conflict"]').exists()).toBe(true);
    expect(modeButton(w)?.text()).toBe("Preview");
  });

  it("stays in the editor, saying why, when the save fails", async () => {
    writeReply = async () => ({ ok: false, status: 500, json: async () => ({ error: "disk full" }) });
    const w = await openReadme(true);
    await modeButton(w)?.trigger("click");
    await flushPromises();

    expect(inPreview(w)).toBe(false);
    expect(w.find('[data-testid="files-error"]').exists()).toBe(true);
  });

  // The save is a round trip, and the reader can open another file while it is out. The Preview
  // they asked for was of the file they were in; it must not land on the next one.
  it("does not switch a file opened while the save was in flight", async () => {
    // Every write is held, and released in an order of the test's choosing: opening the other
    // file saves the buffer too, and that one has to land first so the file is fully open before
    // the Preview's own save comes back.
    const held: Array<() => void> = [];
    writeReply = () =>
      new Promise((resolve) => {
        held.push(() => resolve({ ok: true, status: 200, json: async () => ({ ok: true, version: "v2" }) }));
      });
    const w = await openReadme(true);
    await modeButton(w)?.trigger("click");
    await w.findAll('[data-testid="files-row"]')[1].trigger("click");
    await flushPromises();
    held[1]?.(); // the save made on the way to the other file
    await flushPromises();
    expect(w.text()).toContain("OTHER.md");
    held[0]?.(); // the Preview's save, now arriving over the other file
    await flushPromises();

    expect(held).toHaveLength(2);
    expect(inPreview(w)).toBe(false);
  });

  // What the save learned belongs to the file it saved. Landing on the file opened meanwhile, its
  // version would become that file's baseline — the next save of it then claims to be editing a
  // revision it never had — and a 409 would put a banner over a file with nothing in conflict.
  const heldWrites = () => {
    const held: Array<(reply: Awaited<ReturnType<WriteReply>>) => void> = [];
    writeReply = () => new Promise((resolve) => held.push(resolve));
    return held;
  };
  const openOtherWhilePreviewSaves = async () => {
    const held = heldWrites();
    const w = await openReadme(true);
    await modeButton(w)?.trigger("click");
    await w.findAll('[data-testid="files-row"]')[1].trigger("click");
    await flushPromises();
    held[1]?.({ ok: true, status: 200, json: async () => ({ ok: true, version: "v2" }) });
    await flushPromises();
    return { w, held };
  };

  it("does not hand the late save's version to the file opened meanwhile", async () => {
    const { w, held } = await openOtherWhilePreviewSaves();
    held[0]?.({ ok: true, status: 200, json: async () => ({ ok: true, version: "v3" }) });
    await flushPromises();
    writeReply = saved;
    onChange();
    await flushPromises();
    await w
      .findAll("button")
      .find((b) => b.text().startsWith("Save"))
      ?.trigger("click");
    await flushPromises();

    expect(lastWriteBase()).toBe("o1");
  });

  it("does not raise the late save's conflict over the file opened meanwhile", async () => {
    const { w, held } = await openOtherWhilePreviewSaves();
    held[0]?.({ ok: false, status: 409, json: async () => ({ error: "conflict", version: "v9" }) });
    await flushPromises();

    expect(w.find('[data-testid="files-conflict"]').exists()).toBe(false);
  });

  // A save already out (⌘S, or a first click) is shown as such rather than a click that does nothing.
  it("cannot be pressed while a save is in flight", async () => {
    heldWrites();
    const w = await openReadme(true);
    await modeButton(w)?.trigger("click");
    await flushPromises();

    expect(modeButton(w)?.attributes("disabled")).toBeDefined();
  });

  it("goes back to the editor without writing anything", async () => {
    const w = await openReadme(false);
    await modeButton(w)?.trigger("click");
    await flushPromises();
    await modeButton(w)?.trigger("click");
    await flushPromises();

    expect(inPreview(w)).toBe(false);
    expect(writes()).toEqual([]);
  });
});
