import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { h, KeepAlive, type Component } from "vue";

// App.vue renders GridView inside <KeepAlive>, and the grid registers its openers (new terminal,
// spawned-chat placement) on ACTIVATE so a cached-but-hidden grid is never mutated behind the
// user's back. onActivated does not fire for a bare mount, so a test that skips the KeepAlive
// silently exercises a grid that registered nothing — which is not the component the app runs.
const mountActivated = (component: Component, options: Parameters<typeof mount>[1]) => mount({ render: () => h(KeepAlive, null, [h(component)]) }, options);

// The grid subscribes to the pub/sub socket on mount — stub it so no real socket opens.
vi.mock("../../../src/composables/usePubSub", () => ({
  usePubSub: () => ({ subscribe: () => () => {}, onReconnect: () => () => {} }),
}));

// Session ids for the roster-ordering test (must be valid UUIDs or parseGridState drops them).
const IDS = vi.hoisted(() => ({
  blocked: "11111111-1111-1111-1111-111111111111",
  idleA: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  idleB: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
}));
// Feed one blocked session so the auto sort has something to float to the front.
vi.mock("../../../src/composables/useGridActivity", () => ({
  useGridActivity: () => ({ activity: new Map([[IDS.blocked, { working: false, waiting: true, event: "Notification" }]]) }),
}));

type FetchUrl = string | URL | Request; // what a fetch stub's first argument can be

// Config GET hydrates pushEnabled=true; capture POSTs so we can assert the toggle saves.
const posts: Array<{ url: string; body: unknown }> = [];
beforeEach(() => {
  posts.length = 0;
  localStorage.clear();
  globalThis.fetch = vi.fn(async (url: FetchUrl, init?: RequestInit) => {
    const u = String(url);
    if (u.includes("/api/config")) {
      if (init?.method === "POST") posts.push({ url: u, body: init.body });
      return {
        ok: true,
        json: async () => ({
          cwd: "/w",
          home: "/w",
          cwdPresets: [],
          soundFile: null,
          pushEnabled: true,
          prRepos: [],
          launchers: [],
          userMcpServers: [],
          buttons: null,
          chips: null,
        }),
      } as Response;
    }
    return { ok: true, json: async () => ({}) } as Response;
  }) as typeof fetch;
});

// A SettingsModal stub whose props we can inspect + whose emits we can drive.
const SettingsStub = {
  name: "SettingsModal",
  props: ["soundFile", "pushEnabled", "prRepos", "launchers", "userMcpServers", "cwd", "sessionId"],
  emits: ["update-push-enabled", "close"],
  template: '<div class="settings-stub" />',
};
// A toolbar stub that lets us open the settings modal (GridView: @settings="showSettings = true").
const ToolbarStub = { name: "AppToolbar", emits: ["settings"], template: '<button class="open-settings" @click="$emit(\'settings\')" />' };

const mountGrid = async () => {
  const w = mount((await import("../../../src/components/GridView.vue")).default, {
    global: { stubs: { TerminalGrid: true, AppToolbar: ToolbarStub, SettingsModal: SettingsStub } },
  });
  await flushPromises(); // onMounted loadConfig
  return w;
};

// A TerminalGrid stub that exposes the ordering props the roster/grid receive.
const OrderStub = {
  name: "TerminalGrid",
  props: ["cells", "listRows", "expandedUid", "reorderable"],
  template: '<div class="order-stub" />',
};

describe("GridView roster ordering (#720)", () => {
  it("orders the cockpit roster (listRows) attention-first in auto mode, matching the grid", async () => {
    // Auto sort, one cell zoomed (roster visible); the middle cell (uid→1) is the blocked one.
    localStorage.setItem(
      "grid_v2",
      JSON.stringify({
        cells: [
          { uid: 10, session: IDS.idleA, cwd: "/w" },
          { uid: 11, session: IDS.blocked, cwd: "/w" },
          { uid: 12, session: IDS.idleB, cwd: "/w" },
        ],
        expanded: 10,
        page: 0,
        sortMode: "auto",
      }),
    );
    const w = mount((await import("../../../src/components/GridView.vue")).default, {
      global: { stubs: { TerminalGrid: OrderStub, AppToolbar: ToolbarStub, SettingsModal: SettingsStub } },
    });
    await flushPromises();
    const grid = w.findComponent(OrderStub);
    // The blocked cell (renumbered uid 1) floats to the top; the two idle cells keep manual order.
    const rosterOrder = grid.props("listRows").map((r: { uid: number }) => r.uid);
    expect(rosterOrder).toEqual([1, 0, 2]);
    // The grid reads the SAME ordering — roster and grid can't drift.
    expect(grid.props("cells").map((c: { uid: number }) => c.uid)).toEqual([1, 0, 2]);
    w.unmount();
  });

  // The last untested link in the parking chain (#992): the cell's persisted flag has to reach the
  // roster ROW that renders it. rosterAlertClass and the row's binding are each pinned elsewhere,
  // so a mapping stuck at `false` here would leave every one of those green while no roster row
  // ever sank. Driven from localStorage, the way a reloaded grid actually gets the flag.
  it("carries each cell's parked flag onto its roster row", async () => {
    localStorage.setItem(
      "grid_v2",
      JSON.stringify({
        cells: [
          { uid: 20, session: IDS.idleA, cwd: "/w" },
          { uid: 21, session: IDS.idleB, cwd: "/w", parked: true },
        ],
        expanded: 20,
        page: 0,
        sortMode: "manual",
      }),
    );
    const w = mount((await import("../../../src/components/GridView.vue")).default, {
      global: { stubs: { TerminalGrid: OrderStub, AppToolbar: ToolbarStub, SettingsModal: SettingsStub } },
    });
    await flushPromises();
    const rows = w.findComponent(OrderStub).props("listRows");
    expect(rows.map((r: { parked: boolean }) => r.parked)).toEqual([false, true]);
    w.unmount();
  });
});

// A toolbar stub that surfaces the view-toggle props and can fire the toggle-view event, plus a
// TerminalGrid stub exposing the listMode prop — together they trace the header → GridView → grid
// wiring for the roster ⇄ strip toggle.
const ViewToggleToolbarStub = {
  name: "AppToolbar",
  props: ["showViewToggle", "listMode"],
  emits: ["toggle-view"],
  template: '<button class="toggle-view" @click="$emit(\'toggle-view\')" />',
};
const ListModeGridStub = { name: "TerminalGrid", props: ["listMode", "expandedUid"], template: '<div class="lm-stub" />' };

describe("GridView view toggle wiring", () => {
  it("shows the toggle only while zoomed and flips the grid's listMode when the header fires toggle-view", async () => {
    localStorage.setItem("grid_v2", JSON.stringify({ cells: [{ uid: 10, session: IDS.idleA, cwd: "/w" }], expanded: 10, page: 0, sortMode: "manual" }));
    const w = mount((await import("../../../src/components/GridView.vue")).default, {
      global: { stubs: { TerminalGrid: ListModeGridStub, AppToolbar: ViewToggleToolbarStub, SettingsModal: SettingsStub } },
    });
    await flushPromises();
    const toolbar = w.findComponent(ViewToggleToolbarStub);
    const grid = w.findComponent(ListModeGridStub);
    // A cell is expanded → the toggle is offered, and both surfaces start in roster (list) mode.
    expect(toolbar.props("showViewToggle")).toBe(true);
    expect(toolbar.props("listMode")).toBe(true);
    expect(grid.props("listMode")).toBe(true);
    // The header toggle flips roster → strip for the grid too.
    await toolbar.trigger("click");
    expect(grid.props("listMode")).toBe(false);
    expect(toolbar.props("listMode")).toBe(false);
    w.unmount();
  });

  it("hides the toggle when nothing is expanded", async () => {
    localStorage.setItem("grid_v2", JSON.stringify({ cells: [{ uid: 10, session: IDS.idleA, cwd: "/w" }], expanded: null, page: 0, sortMode: "manual" }));
    const w = mount((await import("../../../src/components/GridView.vue")).default, {
      global: { stubs: { TerminalGrid: ListModeGridStub, AppToolbar: ViewToggleToolbarStub, SettingsModal: SettingsStub } },
    });
    await flushPromises();
    expect(w.findComponent(ViewToggleToolbarStub).props("showViewToggle")).toBe(false);
    w.unmount();
  });
});

describe("GridView guide help (empty state)", () => {
  it("shows the guide footer (ja/en links) when no terminal is running, and hides it once one is", async () => {
    // Empty grid: ensureEntry leaves only the entry launch cell, so runningCount === 0.
    const empty = await mountGrid();
    const footer = empty.find("footer");
    expect(footer.exists()).toBe(true);
    const hrefs = footer.findAll("a").map((a) => a.attributes("href"));
    expect(hrefs).toContain("https://receptron.github.io/mulmoterminal/guide/ja/");
    expect(hrefs).toContain("https://receptron.github.io/mulmoterminal/guide/en/");
    empty.unmount();

    // A running session cell (occupied) — the newcomer hint must step out of the way.
    localStorage.setItem("grid_v2", JSON.stringify({ cells: [{ uid: 1, session: IDS.idleA, cwd: "/w" }], expanded: null, page: 0, sortMode: "manual" }));
    const running = mount((await import("../../../src/components/GridView.vue")).default, {
      global: { stubs: { TerminalGrid: true, AppToolbar: ToolbarStub, SettingsModal: SettingsStub } },
    });
    await flushPromises();
    expect(running.find("footer").exists()).toBe(false);
    running.unmount();
  });
});

describe("GridView settings wiring", () => {
  it("passes pushEnabled to SettingsModal and saves it on update-push-enabled (regression #347)", async () => {
    const w = await mountGrid();
    await w.find(".open-settings").trigger("click"); // open the settings modal
    const modal = w.findComponent(SettingsStub);
    expect(modal.exists()).toBe(true);
    // The grid view must reflect the saved config, not a default false.
    expect(modal.props("pushEnabled")).toBe(true);

    // Toggling in the grid view must persist via POST /api/config.
    modal.vm.$emit("update-push-enabled", false);
    await flushPromises();
    const pushPost = posts.find((p) => String(p.body).includes("pushEnabled"));
    expect(pushPost, "toggling push should POST /api/config").toBeTruthy();
    expect(String(pushPost?.body)).toContain('"pushEnabled":false');
  });
});

// --- Keyboard shortcut wiring (#829) -------------------------------------------------
//
// The pure transforms are covered in gridTabs.spec.ts. What is covered HERE is the wiring
// GridView owns, which is where every bug in this feature actually lived: which ordered list
// the shortcuts are given, which cell the cursor is moved to, and whether a key that should
// only move ends up changing the layout.

// Focus calls land here instead of a real xterm.
const focused = vi.hoisted(() => [] as string[]);
vi.mock("../../../src/composables/useTerminalConnections", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  focus: (key: string) => focused.push(key),
}));

import { setActiveKeymap } from "../../../src/composables/activeKeymap";
import { PAGE_SIZE } from "../../../src/components/gridTabs";

const uuid = (n: number) => `${String(n % 10).repeat(8)}-aaaa-aaaa-aaaa-aaaaaaaaaaaa`;

// A TerminalGrid stub that reports the props the shortcuts drive, and can raise focus-cell the
// way the real grid does when a terminal takes the cursor.
const ShortcutGridStub = {
  name: "TerminalGrid",
  props: ["cells", "listRows", "expandedUid", "reorderable"],
  emits: ["focus-cell"],
  template: '<div class="shortcut-stub" />',
};

const press = async (key: string) => {
  window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  await flushPromises();
};

const DEFAULT_KEYMAP = { "zoom-toggle": "F8", "next-attention": "F9", "zoom-next": "PageDown", "zoom-prev": "PageUp" };

/** Mount a grid of `count` running cells, all on the first page unless `page` says otherwise.
 *  The keymap is applied AFTER mounting because GridView's onMounted loadConfig hydrates it
 *  from /api/config — setting it earlier would be overwritten by the stubbed response. */
const mountShortcutGrid = async (count: number, extra: Record<string, unknown> = {}, keymap: unknown = DEFAULT_KEYMAP) => {
  localStorage.setItem(
    "grid_v2",
    JSON.stringify({
      cells: Array.from({ length: count }, (_, i) => ({ uid: i, session: uuid(i), cwd: "/w" })),
      expanded: null,
      page: 0,
      sortMode: "manual",
      ...extra,
    }),
  );
  const w = mount((await import("../../../src/components/GridView.vue")).default, {
    global: { stubs: { TerminalGrid: ShortcutGridStub, AppToolbar: ToolbarStub, SettingsModal: SettingsStub } },
  });
  await flushPromises();
  setActiveKeymap(keymap);
  return w;
};

const gridOf = (w: ReturnType<typeof mount>) => w.findComponent(ShortcutGridStub);

describe("GridView keyboard shortcuts (#829)", () => {
  beforeEach(() => {
    focused.length = 0;
  });

  it("does nothing at all when no keymap is configured — shortcuts are opt-in", async () => {
    // `null`, not `undefined` — passing undefined to a defaulted parameter selects the default.
    const w = await mountShortcutGrid(4, {}, null);
    await press("F8");
    expect(gridOf(w).props("expandedUid")).toBeNull();
    expect(focused).toEqual([]);
    w.unmount();
  });

  it("F8 enlarges, and F8 again collapses", async () => {
    const w = await mountShortcutGrid(4);
    await press("F8");
    expect(gridOf(w).props("expandedUid")).not.toBeNull();
    await press("F8");
    expect(gridOf(w).props("expandedUid")).toBeNull();
    w.unmount();
  });

  it("F8 enlarges the FOCUSED terminal, not the first of the page", async () => {
    const w = await mountShortcutGrid(4);
    gridOf(w).vm.$emit("focus-cell", 2); // the cursor is in cell 2
    await flushPromises();
    await press("F8");
    expect(gridOf(w).props("expandedUid")).toBe(2);
    w.unmount();
  });

  it("keeps the cursor on the same terminal across enlarge and collapse", async () => {
    const w = await mountShortcutGrid(4);
    gridOf(w).vm.$emit("focus-cell", 2);
    await flushPromises();
    await press("F8");
    expect(focused.at(-1)).toBe("cell-2");
    await press("F8"); // collapse — the selection must stay on 2, not jump elsewhere
    expect(focused.at(-1)).toBe("cell-2");
    w.unmount();
  });

  // The bug that made F9 look dead: with no origin the rotation restarted every press.
  it("F9 advances through terminals instead of picking the same one every time", async () => {
    const w = await mountShortcutGrid(4);
    await press("F9");
    const first = focused.at(-1);
    // Report the focus back the way the real grid does, so the next press has an origin.
    gridOf(w).vm.$emit("focus-cell", Number(first?.replace("cell-", "")));
    await flushPromises();
    await press("F9");
    expect(focused.at(-1)).not.toBe(first);
    w.unmount();
  });

  it("F9 NEVER enlarges or collapses — only F8 changes that", async () => {
    const w = await mountShortcutGrid(4);
    await press("F9");
    expect(gridOf(w).props("expandedUid")).toBeNull(); // still a grid

    await press("F8"); // now zoomed
    const zoomed = gridOf(w).props("expandedUid");
    expect(zoomed).not.toBeNull();
    await press("F9");
    expect(gridOf(w).props("expandedUid")).not.toBeNull(); // still zoomed, just a different cell
    w.unmount();
  });

  // Regression: shortcuts used to be handed the visible page slice, so a cell calling from
  // another page was unreachable and the page maths were computed against the wrong origin.
  it("reaches a terminal on another page, and shows that page", async () => {
    const w = await mountShortcutGrid(PAGE_SIZE + 3, { page: 0 });
    gridOf(w).vm.$emit("focus-cell", PAGE_SIZE - 1); // last cell of page 0
    await flushPromises();
    await press("F9");
    // It moved onto a cell the first page does not contain...
    expect(focused.at(-1)).toBe(`cell-${PAGE_SIZE}`);
    // ...and that cell is now among the rendered ones.
    expect(
      gridOf(w)
        .props("cells")
        .map((c: { uid: number }) => c.uid),
    ).toContain(PAGE_SIZE);
    w.unmount();
  });

  it("PageDown/PageUp walk the enlarged terminal and stop at the ends", async () => {
    const w = await mountShortcutGrid(4);
    gridOf(w).vm.$emit("focus-cell", 0);
    await flushPromises();
    await press("F8");
    expect(gridOf(w).props("expandedUid")).toBe(0);
    await press("PageDown");
    expect(gridOf(w).props("expandedUid")).toBe(1);
    await press("PageUp");
    expect(gridOf(w).props("expandedUid")).toBe(0);
    await press("PageUp"); // already at the front — stays put
    expect(gridOf(w).props("expandedUid")).toBe(0);
    w.unmount();
  });

  it("leaves Shift+PageDown to the terminal when only the bare key is bound", async () => {
    const w = await mountShortcutGrid(4);
    await press("F8");
    const before = gridOf(w).props("expandedUid");
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "PageDown", shiftKey: true, bubbles: true }));
    await flushPromises();
    expect(gridOf(w).props("expandedUid")).toBe(before);
    w.unmount();
  });

  it("ignores an unbound key", async () => {
    const w = await mountShortcutGrid(4);
    await press("F7");
    expect(gridOf(w).props("expandedUid")).toBeNull();
    expect(focused).toEqual([]);
    w.unmount();
  });
});

// A Settings skill button pressed in the GRID opens the skill's session as a grid CELL. It used to
// route to the single view, which put the user on a different screen than the one they pressed the
// button on (reported against #1111's first cut).
const SkillSettingsStub = {
  name: "SettingsModal",
  props: ["cwd", "sessionId"],
  emits: ["launch-skill", "close"],
  template: "<button class=\"launch-theme\" @click=\"$emit('launch-skill', 'mulmoterminal-theme')\" />",
};
const CellsStub = { name: "TerminalGrid", props: ["cells"], template: '<div class="cells-stub" />' };

describe("GridView skill launch (#1111)", () => {
  const SPAWNED = "cccccccc-cccc-cccc-cccc-cccccccccccc";

  const mountWithSpawn = async () => {
    const spawns: unknown[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (url: FetchUrl, init?: RequestInit) => {
      if (String(url).includes("spawnBackgroundChat")) {
        spawns.push(JSON.parse(String(init?.body)));
        return { ok: true, json: async () => ({ jsonData: { chatId: SPAWNED } }) } as Response;
      }
      return realFetch(url, init);
    }) as typeof fetch;
    const w = mountActivated((await import("../../../src/components/GridView.vue")).default, {
      global: { stubs: { TerminalGrid: CellsStub, AppToolbar: ToolbarStub, SettingsModal: SkillSettingsStub } },
    });
    await flushPromises();
    await w.find(".open-settings").trigger("click");
    await w.find(".launch-theme").trigger("click");
    await flushPromises();
    return { w, spawns };
  };

  type LaunchedCell = { session: string | null; cwd: string | null; agent?: string };
  const spawnedCells = (w: ReturnType<typeof mount>) => (w.findComponent(CellsStub).props("cells") as LaunchedCell[]).filter((c) => c.session === SPAWNED);

  it("seeds the skill's slash command and shows the session in a cell of its own", async () => {
    const { w, spawns } = await mountWithSpawn();
    expect(spawns).toEqual([{ message: "/mulmoterminal-theme", draft: false, agent: "claude" }]);
    const spawned = spawnedCells(w);
    expect(spawned).toHaveLength(1);
    // Seeded with the directory the server spawns these in, so the cell's header isn't blank while
    // claude boots (/api/config reports it as `cwd`, stubbed to /w above).
    expect(spawned[0].cwd).toBe("/w");
    // Claude is the ABSENT case — an explicit `agent: undefined` does not survive the JSON a
    // persisted cell round-trips, so the key must not be written at all.
    expect("agent" in spawned[0]).toBe(false);
    w.unmount();
  });

  // A spawn follows the Claude/Codex/Antigravity toggle (`mt-launch-agent`), and a cell with no
  // agent flag reconnects on Claude's endpoint — so a codex session would attach as claude. The
  // old single-view path got the agent via the opener's `opts`; the grid has to carry it itself.
  // `launchAgent` (the exported ref) is set directly rather than through localStorage + a module
  // reset: resetModules hands the test and the component DIFFERENT copies of useChatLauncher, so
  // the opener one of them registers is invisible to the other.
  it.each(["codex", "antigravity"] as const)("marks the cell with the agent that was spawned (%s)", async (agent) => {
    const { launchAgent } = await import("../../../src/composables/useChatLauncher");
    launchAgent.value = agent;
    try {
      const { w, spawns } = await mountWithSpawn();
      expect(spawns).toEqual([{ message: "/mulmoterminal-theme", draft: false, agent }]);
      expect(spawnedCells(w)[0].agent).toBe(agent);
      w.unmount();
    } finally {
      launchAgent.value = "claude"; // a module singleton — leaving it set would follow later tests
    }
  });

  // The regression itself: handing the session to the single-view opener is what yanked the user
  // out of the grid. The grid must adopt it instead, so that opener stays untouched.
  it("does not hand the session to the single view's opener", async () => {
    const openSession = vi.fn();
    (await import("../../../src/composables/useChatLauncher")).registerChatOpener(openSession);
    const { w } = await mountWithSpawn();
    expect(openSession).not.toHaveBeenCalled();
    w.unmount();
  });
});

// Two conditions the launch depends on, varied — neither is exercised by the happy path above, and
// both fail as "pressing the button did nothing", which is the complaint that produced this code.
describe("GridView skill launch — capacity and placement (#1111)", () => {
  const SPAWNED = "dddddddd-dddd-dddd-dddd-dddddddddddd";
  // A distinct UUID per cell: parseGridState keeps only cells whose session is a valid one.
  const filledGrid = (count: number) =>
    JSON.stringify({
      cells: Array.from({ length: count }, (_, i) => ({ uid: i, session: `eeeeeeee-eeee-eeee-eeee-${String(i).padStart(12, "0")}`, cwd: "/w" })),
      expanded: null,
      page: 0,
      sortMode: "manual",
    });

  const launchFrom = async (persisted: string | null) => {
    if (persisted) localStorage.setItem("grid_v2", persisted);
    const realFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (url: FetchUrl, init?: RequestInit) => {
      if (String(url).includes("spawnBackgroundChat")) return { ok: true, json: async () => ({ jsonData: { chatId: SPAWNED } }) } as Response;
      return realFetch(url, init);
    }) as typeof fetch;
    const w = mountActivated((await import("../../../src/components/GridView.vue")).default, {
      global: { stubs: { TerminalGrid: CellsStub, AppToolbar: ToolbarStub, SettingsModal: SkillSettingsStub } },
    });
    await flushPromises();
    await w.find(".open-settings").trigger("click");
    await w.find(".launch-theme").trigger("click");
    await flushPromises();
    return w;
  };

  // A cell appended past the current page is invisible, which is indistinguishable from a button
  // that did nothing. insertCellAfter jumps to the new cell's page; this pins that it does.
  it("shows the new cell on screen when the current page is already full", async () => {
    const w = await launchFrom(filledGrid(9)); // PAGE_SIZE — page 0 has no room left
    const visible = (w.findComponent(CellsStub).props("cells") as Array<{ session: string | null }>).map((c) => c.session);
    expect(visible).toContain(SPAWNED);
    w.unmount();
  });

  // At the cap insertCellAfter drops the cell, so adopting it here would spawn a live agent with
  // nowhere in the grid to appear. It falls back to the single view's opener instead of vanishing.
  it("falls back to the single view rather than losing the session when the grid is full", async () => {
    const openSession = vi.fn();
    (await import("../../../src/composables/useChatLauncher")).registerChatOpener(openSession);
    const w = await launchFrom(filledGrid(81)); // MAX_TERMINALS
    expect(openSession).toHaveBeenCalledWith(SPAWNED, expect.objectContaining({ agent: "claude" }));
    w.unmount();
  });

  // What the seeded collection is FOR: the Canvas pane exists only beside an enlarged cell, so a
  // card placed into a tiled one is two gestures away and invisible until both are made. Reported
  // live — the card was landing correctly and looked like a feature that did nothing.
  it("enlarges the placed cell and opens its Canvas when a collection was seeded", async () => {
    const { placeSpawnedChat } = await import("../../../src/composables/useSpawnedChat");
    const opened: number[] = [];
    const CanvasGridStub = {
      name: "TerminalGrid",
      props: ["cells", "expandedUid"],
      template: '<div class="canvas-stub" />',
      setup: (_: unknown, { expose }: { expose: (api: Record<string, unknown>) => void }) => {
        expose({ openCanvasFor: (uid: number) => opened.push(uid) });
        return () => {};
      },
    };
    const w = mountActivated((await import("../../../src/components/GridView.vue")).default, {
      global: { stubs: { TerminalGrid: CanvasGridStub, AppToolbar: ToolbarStub, SettingsModal: SkillSettingsStub } },
    });
    await flushPromises();

    placeSpawnedChat({ id: SPAWNED, agent: "claude", draft: false, canvas: true });
    await flushPromises();

    // The uid of the cell just placed for THIS session — not a guess at the counter.
    const cells = w.findComponent(CanvasGridStub).props("cells") as Array<{ uid: number; session: string | null }>;
    const placedUid = cells.find((c) => c.session === SPAWNED)?.uid;
    expect(placedUid).toBeDefined();
    expect(opened).toEqual([placedUid]);
    w.unmount();
  });

  it("leaves the grid alone when nothing was seeded", async () => {
    // Every other spawn — a skill button, a template card, cron. Taking over the screen to show an
    // empty pane is worse than leaving the grid as the user arranged it.
    const { placeSpawnedChat } = await import("../../../src/composables/useSpawnedChat");
    const opened: number[] = [];
    const CanvasGridStub = {
      name: "TerminalGrid",
      props: ["cells", "expandedUid"],
      template: '<div class="canvas-stub" />',
      setup: (_: unknown, { expose }: { expose: (api: Record<string, unknown>) => void }) => {
        expose({ openCanvasFor: (uid: number) => opened.push(uid) });
        return () => {};
      },
    };
    const w = mountActivated((await import("../../../src/components/GridView.vue")).default, {
      global: { stubs: { TerminalGrid: CanvasGridStub, AppToolbar: ToolbarStub, SettingsModal: SkillSettingsStub } },
    });
    await flushPromises();

    placeSpawnedChat({ id: SPAWNED, agent: "claude", draft: false, canvas: false });
    await flushPromises();

    expect(opened).toEqual([]);
    w.unmount();
  });

  // The full-grid fallback is the ONE path where `draft` still has to reach the single view, and
  // it is the easiest to drop: the cell it would otherwise have made needs no such flag (the
  // server types the draft into the PTY), so nothing else here carries one. Without it a
  // startNewChatDraft at MAX_TERMINALS silently loses the "preparing your draft…" hint and reads
  // as a turn already running.
  it("carries `draft` into the single-view fallback when the grid is full", async () => {
    const openSession = vi.fn();
    (await import("../../../src/composables/useChatLauncher")).registerChatOpener(openSession);
    const { placeSpawnedChat } = await import("../../../src/composables/useSpawnedChat");
    localStorage.setItem("grid_v2", filledGrid(81)); // MAX_TERMINALS
    const w = mountActivated((await import("../../../src/components/GridView.vue")).default, {
      global: { stubs: { TerminalGrid: CellsStub, AppToolbar: ToolbarStub, SettingsModal: SkillSettingsStub } },
    });
    await flushPromises();

    // Straight through the placement seam: a draft spawn is startNewChatDraft's, and going via a
    // skill button would only ever produce draft:false.
    placeSpawnedChat({ id: SPAWNED, agent: "claude", draft: true, canvas: false });
    await flushPromises();

    expect(openSession).toHaveBeenCalledWith(SPAWNED, expect.objectContaining({ agent: "claude", draft: true }));
    w.unmount();
  });
});

// #1114: the launch form's Shell option sends a launcher with no configured index — the grid has to
// store it as a shell launcher cell. The old handler rebuilt the launcher from `pick.index` alone,
// which would have written `{ index: undefined }` and reconnected the cell as a Claude session.
const ShellLaunchStub = {
  name: "TerminalGrid",
  props: ["cells"],
  emits: ["launch"],
  template: "<button class=\"fire-shell\" @click=\"$emit('launch', cells[0].uid, { launcher: { shell: true, label: 'shell' }, cwd: '/proj' })\" />",
};

describe("GridView launcher picks (#1114)", () => {
  it("turns the cell into a shell launcher cell when the form picks Shell", async () => {
    const w = mount((await import("../../../src/components/GridView.vue")).default, {
      global: { stubs: { TerminalGrid: ShellLaunchStub, AppToolbar: ToolbarStub, SettingsModal: SettingsStub } },
    });
    await flushPromises();
    await w.find(".fire-shell").trigger("click");
    type LauncherCell = { launcher?: { shell?: true; index?: number; label: string } | null; cwd: string | null };
    const cells = w.findComponent(ShellLaunchStub).props("cells") as LauncherCell[];
    expect(cells[0].launcher).toEqual({ shell: true, label: "shell" });
    expect(cells[0].cwd).toBe("/proj");
    w.unmount();
  });
});
