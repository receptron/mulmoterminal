import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";

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

// Config GET hydrates pushEnabled=true; capture POSTs so we can assert the toggle saves.
const posts: Array<{ url: string; body: unknown }> = [];
beforeEach(() => {
  posts.length = 0;
  localStorage.clear();
  globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
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
