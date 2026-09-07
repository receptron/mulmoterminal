import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import MulmoMenu from "../../../src/components/MulmoMenu.vue";
import { useAppConfig } from "../../../src/composables/useAppConfig";

// `storiesRoot` is a module-level singleton in useAppConfig, so setting it here is what a loaded
// /api/config does for the real app.
const setRoot = (root: { id: string; paths: string[] } | null) => {
  useAppConfig().storiesRoots.value = root === null ? [] : [root];
};

const answerWith = (decks: unknown) => {
  globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ decks }) }) as unknown as Response) as unknown as typeof fetch;
};

const WS = "/work/ws";
const ROOT = { id: "root-a", paths: [WS] };

describe("MulmoMenu", () => {
  beforeEach(() => setRoot(ROOT));
  afterEach(() => setRoot(null));

  const open = async (cwd: string | null) => {
    const w = mount(MulmoMenu, { props: { cwd } });
    await flushPromises();
    return w;
  };
  const btn = (w: Awaited<ReturnType<typeof open>>) => w.find('[data-testid="mulmo-menu-btn"]');
  const labels = (w: Awaited<ReturnType<typeof open>>) => w.findAll('[data-testid="mulmo-menu-item"]').map((i) => i.text().replace(/^space_dashboard\s*/, ""));

  it("offers the decks the server listed, by their labels", async () => {
    answerWith([
      { path: `${WS}/decks/talk.json`, label: "Launch talk" },
      { path: `${WS}/artifacts/stories/plan.json`, label: "plan.json" },
    ]);
    const w = await open(WS);
    expect(btn(w).exists()).toBe(true);
    await btn(w).trigger("click");
    // The icon is a Material Symbols ligature, so its name is part of the row's text — assert the
    // label the user reads, not the node's whole text.
    expect(labels(w)).toEqual(["Launch talk", "plan.json"]);
  });

  // The rule this menu shares with the file tree's row menu, rather than restating — which is why
  // relaxing that gate for #1976 lands here too: a deck outside every registered root is addressed
  // by its absolute path, so a cell that can list one can now offer it.
  it("shows the button for a deck outside the registered stories root", async () => {
    answerWith([{ path: "/somewhere/else/decks/talk.json", label: "Launch talk" }]);
    expect(btn(await open("/somewhere/else")).exists()).toBe(true);
  });

  it("shows no button when the directory holds no deck", async () => {
    answerWith([]);
    expect(btn(await open(WS)).exists()).toBe(false);
  });

  it("hands back the deck's absolute path", async () => {
    answerWith([{ path: `${WS}/decks/talk.json`, label: "Launch talk" }]);
    const w = await open(WS);
    await btn(w).trigger("click");
    await w.find('[data-testid="mulmo-menu-item"]').trigger("click");
    expect(w.emitted("deck")).toEqual([[`${WS}/decks/talk.json`]]);
  });

  // An empty cwd would be resolved by the server to the DEFAULT workspace, so the menu would list
  // another project's decks under this cell's name.
  it("asks nothing at all without a resolved directory", async () => {
    answerWith([{ path: `${WS}/decks/talk.json`, label: "Launch talk" }]);
    const w = await open(null);
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(btn(w).exists()).toBe(false);
  });

  it("ignores rows that are not the shape it was promised", async () => {
    answerWith([{ path: `${WS}/decks/talk.json` }, { label: "no path" }, "text", null, { path: `${WS}/decks/ok.json`, label: "Ok" }]);
    const w = await open(WS);
    await btn(w).trigger("click");
    expect(labels(w)).toEqual(["Ok"]);
  });

  // The replacement list is a round trip, and `pick` joins against the directory the list came
  // from. A list left standing across that gap would offer the old project's labels — and, if the
  // new project happens to hold the same relative path, open a DIFFERENT deck under an old name
  // (Codex on #1950).
  it("offers nothing while a new directory's list is still in flight", async () => {
    const held: Array<() => void> = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) =>
      String(input).includes("other")
        ? new Promise<Response>((resolve) => {
            held.push(() =>
              resolve({ ok: true, json: async () => ({ decks: [{ path: `${WS}/other/decks/other.json`, label: "Other" }] }) } as unknown as Response),
            );
          })
        : ({ ok: true, json: async () => ({ decks: [{ path: `${WS}/decks/talk.json`, label: "Launch talk" }] }) } as unknown as Response),
    ) as unknown as typeof fetch;

    const w = mount(MulmoMenu, { props: { cwd: WS } });
    await flushPromises();
    expect(btn(w).exists()).toBe(true); // the first directory's list arrived

    await w.setProps({ cwd: `${WS}/other` });
    await flushPromises();
    expect(btn(w).exists()).toBe(false); // …and is not offered under the new directory's name

    expect(held).toHaveLength(1); // the replacement IS in flight, so the gap under test is real
    held.forEach((release) => release());
    await flushPromises();
    await btn(w).trigger("click");
    expect(labels(w)).toEqual(["Other"]);
  });

  it("shows no button when the listing fails", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    expect(btn(await open(WS)).exists()).toBe(false);
  });
});
