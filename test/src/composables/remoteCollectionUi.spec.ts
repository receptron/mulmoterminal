// #3506. A remote cell's collection card reads its records on the cell's host and does nothing else:
// no write, no chat, no pin and no navigation reaches either machine from it.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { defineComponent, h } from "vue";
import { mount, flushPromises } from "@vue/test-utils";
import type { CollectionUi } from "@mulmoclaude/collection-plugin/vue";
import { REMOTE_CELL_DECLINE_EN } from "../../../src/components/remoteCell";
import { PLUGIN_HOST_KEY } from "../../../src/composables/pluginRuntime";

const fetched: string[] = [];
vi.mock("../../../src/utils/fetchWithTimeout", () => ({
  fetchWithTimeout: async (url: string) => {
    fetched.push(url);
    return new Response(JSON.stringify({ collection: { slug: "todos" }, items: [] }), { headers: { "content-type": "application/json" } });
  },
}));
const reconcile = vi.fn(async () => {});
const unpin = vi.fn(async () => true);
vi.mock("../../../src/composables/useShortcuts", () => ({ useShortcuts: () => ({ reconcile, unpin }) }));
const startCollectionChat = vi.fn();
vi.mock("../../../src/composables/useChatLauncher", () => ({ startCollectionChat }));

// The card's own view, standing in for the package's: it scopes the subtree the way the real card
// does, and its child reads the binding the way every component under it does.
const seen: { ui: CollectionUi | null } = { ui: null };
vi.mock("@mulmoclaude/collection-plugin/vue", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mulmoclaude/collection-plugin/vue")>();
  const Reader = defineComponent({
    setup() {
      seen.ui = actual.useCollectionUi();
      return () => h("div");
    },
  });
  const Card = defineComponent({
    props: { selectedResult: { type: Object, default: null } },
    setup(props) {
      actual.provideCollectionScope(() => (props.selectedResult as { data?: { scope?: string } } | null)?.data?.scope);
      return () => h(Reader);
    },
  });
  return { ...actual, plugin: { ...actual.plugin, viewComponent: Card } };
});

const { remoteCollectionUi } = await import("../../../src/composables/collectionUi");
const CollectionCardView = (await import("../../../src/components/CollectionCardView.vue")).default;

// Every entry that reads the host or acts on either machine, called with arguments of its shape.
const ENTRIES: [keyof CollectionUi, unknown[]][] = [
  ["listCollections", []],
  ["listFeeds", []],
  ["listRegistry", []],
  ["importRegistry", ["a", "todos", null]],
  ["createItem", ["todos", { id: "1" }]],
  ["updateItem", ["todos", "1", { id: "1" }]],
  ["deleteItem", ["todos", "1"]],
  ["deleteCollection", ["todos"]],
  ["deleteFeed", ["news"]],
  ["deleteView", ["todos", "v"]],
  ["runItemAction", ["todos", "1", "a"]],
  ["runCollectionAction", ["todos", "a"]],
  ["refreshCollection", ["todos"]],
  ["pushCalendarCollection", ["todos"]],
  ["mintViewToken", ["todos", "v"]],
  ["fetchViewHtml", ["todos", "v"]],
  ["fetchViewI18n", ["todos", "v", "en"]],
  ["reconcileShortcuts", ["collection", []]],
  ["unpin", ["collection", "todos"]],
  ["startChat", ["hi", "general"]],
  ["startNewChatDraft", ["hi"]],
  ["setSelectedId", ["1"]],
  ["gotoIndex", ["collection"]],
  ["gotoDetail", ["collection", "todos"]],
  ["navigateToRecord", ["todos", "1"]],
];

const call = async (ui: CollectionUi, name: keyof CollectionUi, args: unknown[]): Promise<unknown> => {
  const entry: unknown = ui[name];
  if (typeof entry !== "function") throw new Error(`${name} is not a function`);
  return await Reflect.apply(entry, ui, args);
};

beforeEach(() => {
  fetched.length = 0;
  reconcile.mockClear();
  unpin.mockClear();
  startCollectionChat.mockClear();
  seen.ui = null;
});

describe("the binding for a card read on another machine", () => {
  it("reads a collection's records on the host, in the default project", async () => {
    const result = await remoteCollectionUi("lx").fetchCollectionDetail("my list");
    expect(result.ok).toBe(true);
    expect(fetched).toEqual(["/remote/lx/api/collections/my%20list/detail"]);
  });

  it("reads them in the project the card names, which is an id on the host", async () => {
    await remoteCollectionUi("lx").withScope?.("p 1").fetchCollectionDetail("todos");
    expect(fetched).toEqual(["/remote/lx/api/collections/todos/detail?project=p%201"]);
  });

  it.each(ENTRIES)("%s reaches neither machine", async (name, args) => {
    const result = await call(remoteCollectionUi("lx"), name, args);
    expect(fetched).toEqual([]);
    expect(reconcile).not.toHaveBeenCalled();
    expect(unpin).not.toHaveBeenCalled();
    expect(startCollectionChat).not.toHaveBeenCalled();
    if (result !== null && typeof result === "object" && "ok" in result) expect(result).toMatchObject({ ok: false });
    if (result !== null && typeof result === "object" && "error" in result) expect(result).toMatchObject({ error: REMOTE_CELL_DECLINE_EN });
  });

  it("offers no view of the host it cannot read", () => {
    const ui = remoteCollectionUi("lx");
    expect([ui.fetchOntology, ui.fetchRemoteView, ui.mutateRemoteView, ui.fetchRemoteViewItems, ui.subscribeChanges, ui.recordHref, ui.navigate]).toEqual(
      Array(7).fill(undefined),
    );
    expect([ui.routeSlug(), ui.routeSelectedId(), ui.isFeedRoute(), ui.fileAssetUrl("a.html"), ui.fileRoutePath("a.html")]).toEqual([
      undefined,
      undefined,
      false,
      null,
      null,
    ]);
    expect(ui.notifiedSeverities("todos").size).toBe(0);
  });

  it("shows a picture written into the record and no file of either machine", () => {
    const ui = remoteCollectionUi("lx");
    expect(ui.imageSrc("data:image/png;base64,AA==")).toBe("data:image/png;base64,AA==");
    expect(ui.imageSrc("images/a.png")).toBe("");
  });

  it("is one binding per host", () => {
    expect(remoteCollectionUi("lx")).toBe(remoteCollectionUi("lx"));
    expect(remoteCollectionUi("lx")).not.toBe(remoteCollectionUi("ly"));
  });
});

describe("the collection card on a cell", () => {
  const mountOn = async (host: string | null, scope?: string): Promise<void> => {
    mount(
      defineComponent({
        provide: { [PLUGIN_HOST_KEY]: () => host },
        setup() {
          return () => h(CollectionCardView, { selectedResult: { toolName: "presentCollection", uuid: "u", message: "", data: scope ? { scope } : {} } });
        },
      }),
    );
    await seen.ui?.fetchCollectionDetail("todos");
    await flushPromises();
  };

  it("reads on the remote cell's host, in the project the card names", async () => {
    await mountOn("lx", "p1");
    expect(fetched).toEqual(["/remote/lx/api/collections/todos/detail?project=p1"]);
  });

  it("reads on this server for a local cell", async () => {
    await mountOn(null, "p1");
    expect(fetched).toEqual(["/api/collections/todos/detail?project=p1"]);
  });
});
