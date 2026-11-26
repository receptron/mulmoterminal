import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import CellChromeButtons from "../../../src/components/CellChromeButtons.vue";
import { CELL_BTN, CELL_CLOSE_BTN } from "../../../src/components/cellChromeClasses";

const mountButtons = (expanded = false) => mount(CellChromeButtons, { props: { expanded } });
const PARK = '[data-testid="cell-park-btn"]';

describe("CellChromeButtons", () => {
  // Both buttons must carry their styling as utilities. As scoped CSS it reached neither: this
  // component's template has a fragment root, and Vue gives the parent cell's scope id to a
  // single root element only — so both rendered with the browser's default button chrome while
  // the neighbouring ◀ ▶ (in the cell's own template) did not (#787, #791).
  it("styles both buttons with utilities rather than a stylesheet", () => {
    const w = mountButtons();
    expect(w.find('[aria-label="Expand terminal"]').classes()).toEqual(expect.arrayContaining(CELL_BTN.split(" ")));
    expect(w.find('[aria-label="Close terminal"]').classes()).toEqual(expect.arrayContaining(CELL_CLOSE_BTN.split(" ")));
  });

  // The close button's red hover is the whole reason it isn't just CELL_BTN.
  it("gives the close button its own hover colours", () => {
    expect(mountButtons().find('[aria-label="Close terminal"]').classes()).not.toContain("hover:bg-hover");
  });

  it("keeps the cell-btn / cell-close hooks the grid and the specs select on", () => {
    const w = mountButtons();
    expect(w.find('[aria-label="Expand terminal"]').classes()).toContain("cell-btn");
    expect(w.find('[aria-label="Close terminal"]').classes()).toEqual(expect.arrayContaining(["cell-btn", "cell-close"]));
  });

  it("offers expand while tiled and restore while expanded", () => {
    expect(mountButtons(false).find(".cell-btn").text()).toBe("open_in_full");
    const expanded = mountButtons(true);
    expect(expanded.find(".cell-btn").text()).toBe("close_fullscreen");
    expect(expanded.find(".cell-btn").attributes("data-tip")).toBe("Restore");
    expect(expanded.find('[aria-label="Restore terminal"]').exists()).toBe(true);
  });

  it("emits toggle-expand and close from their own buttons", async () => {
    const w = mountButtons();
    expect(w.find('[aria-label="Close terminal"]').text()).toBe("power_settings_new");
    await w.find('[aria-label="Expand terminal"]').trigger("click");
    await w.find('[aria-label="Close terminal"]').trigger("click");
    expect(w.emitted("toggle-expand")).toHaveLength(1);
    expect(w.emitted("close")).toHaveLength(1);
  });
});

// The files pane opens from the path menu's Browse files, on every cell type (#2364), so the header
// no longer carries a button for it. Pinned so a restore has to argue with this comment.
describe("CellChromeButtons — no files button", () => {
  it("offers no files toggle on a tile or an enlarged cell", () => {
    for (const expanded of [false, true]) {
      const w = mountButtons(expanded);
      expect(w.findAll(".cell-btn").some((b) => b.find(".material-symbols-outlined").text() === "folder_open")).toBe(false);
    }
  });

  // Expand/restore sits beside close at the row's end. Read from the DOM: `findAll` lists a child
  // component's buttons (the history / tools menus) after the parent's own.
  it("puts expand/restore immediately before close", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    mount(CellChromeButtons, { props: { expanded: true, timelineAvailable: true }, attachTo: host });
    const labels = [...host.querySelectorAll<HTMLElement>(".cell-btn")].map((b) => b.getAttribute("aria-label"));
    expect(labels.slice(-2)).toEqual(["Restore terminal", "Close terminal"]);
  });
});

// The cell's own launch button (#1867) is gone: it sat beside close in every view, and the
// toolbar's `+`, the path menu's New terminal here and the `terminal-new-here` shortcut already
// start a terminal. Pinned so a restore has to argue with this comment.
describe("the launch button", () => {
  it("is not offered on a tile or an enlarged cell", () => {
    for (const expanded of [false, true]) {
      const w = mount(CellChromeButtons, { props: { expanded } });
      expect(w.findAll(".cell-btn").some((b) => b.find(".material-symbols-outlined").text() === "add")).toBe(false);
    }
  });
});

// History and tools are two menus now (#2311): what each lists is cellPaneMenuEntries' (its own
// spec), and these pin the header side — which trigger shows when, that it reads as pressed while
// one of its panes is open, and that a pick raises the same event the button it replaced did.
describe("the history and tools menus", () => {
  const mountAt = (props: Record<string, unknown>) => mount(CellChromeButtons, { props: { expanded: true, ...props }, attachTo: document.body });
  const itemIn = (id: string) => document.body.querySelector<HTMLButtonElement>(`[data-testid="cell-pane-menu-${id}"]`);
  const isMarked = (classes: string[]) => classes.includes("bg-selected") && classes.includes("text-accent");

  it("shows both triggers on an enlarged cell", () => {
    const w = mountAt({});
    expect(w.find('[data-testid="cell-history-btn"]').exists()).toBe(true);
    expect(w.find('[data-testid="cell-tools-btn"]').exists()).toBe(true);
  });

  // On a tile the panes have no room; only the timeline (an overlay) can open there.
  // #3027: a pane opens beside the tiles too, so a tile has both menus with nothing else in them.
  it("offers both menus on a tile", () => {
    expect(mountAt({ expanded: false }).find('[data-testid="cell-history-btn"]').exists()).toBe(true);
    expect(mountAt({ expanded: false }).find('[data-testid="cell-tools-btn"]').exists()).toBe(true);
  });

  it("maps each pick to the event its old button raised", async () => {
    const picks: [string, string, string][] = [
      ["cell-history-btn", "prompts", "toggle-prompts"],
      ["cell-history-btn", "transcript", "toggle-transcript"],
      ["cell-history-btn", "timeline", "open-timeline"],
      ["cell-history-btn", "library", "open-library"],
      ["cell-tools-btn", "tools", "toggle-tools"],
      ["cell-tools-btn", "canvas", "toggle-canvas"],
      ["cell-tools-btn", "collections", "toggle-collections"],
      ["cell-tools-btn", "talk", "open-talk"],
      ["cell-tools-btn", "restart", "restart-agent"],
    ];
    for (const [trigger, id, event] of picks) {
      const w = mountAt({
        canvasAvailable: true,
        collectionsAvailable: true,
        timelineAvailable: true,
        libraryAvailable: true,
        restartAvailable: true,
        talkAvailable: true,
      });
      await w.find(`[data-testid="${trigger}"]`).trigger("click");
      itemIn(id)?.click();
      await w.vm.$nextTick();
      expect(w.emitted(event), `${id} -> ${event}`).toHaveLength(1);
      w.unmount();
    }
  });

  // The talk row depends on a snapshot the parent takes, so opening the Tools menu asks for it first.
  it("says the Tools menu is opening, and not when it closes or for History", async () => {
    const w = mountAt({ restartAvailable: true, timelineAvailable: true });
    await w.find('[data-testid="cell-tools-btn"]').trigger("click");
    await w.find('[data-testid="cell-tools-btn"]').trigger("click");
    await w.find('[data-testid="cell-history-btn"]').trigger("click");
    expect(w.emitted("tools-opening")).toHaveLength(1);
    w.unmount();
  });

  // Which pane is open used to show on its own button; now the menu's trigger carries it.
  it("marks the trigger whose pane is open, and only that one", () => {
    const tools = mountAt({ rightPane: "canvas", canvasAvailable: true });
    expect(isMarked(tools.find('[data-testid="cell-tools-btn"]').classes())).toBe(true);
    expect(isMarked(tools.find('[data-testid="cell-history-btn"]').classes())).toBe(false);
    const history = mountAt({ rightPane: "transcript" });
    expect(isMarked(history.find('[data-testid="cell-history-btn"]').classes())).toBe(true);
    expect(isMarked(history.find('[data-testid="cell-tools-btn"]').classes())).toBe(false);
    const none = mountAt({ rightPane: null });
    expect(none.findAll("button").filter((b) => isMarked(b.classes()))).toHaveLength(0);
  });

  // The pressed classes REPLACE the idle ones: appended, `bg-transparent` would stay and which of
  // two competing utilities wins would be Tailwind's output order.
  it("swaps the idle fill out rather than layering over it", () => {
    expect(mountAt({ rightPane: "tools" }).find('[data-testid="cell-tools-btn"]').classes()).not.toContain("bg-transparent");
    expect(mountAt({ rightPane: null }).find('[data-testid="cell-tools-btn"]').classes()).toContain("bg-transparent");
  });

  // A disabled Canvas is exactly when someone asks why, so its line carries the fix, restart included.
  it("lists Canvas disabled, with the fix, when the session has no render tools", async () => {
    const w = mountAt({ canvasAvailable: false });
    await w.find('[data-testid="cell-tools-btn"]').trigger("click");
    const canvas = itemIn("canvas");
    expect(canvas?.disabled).toBe(true);
    expect(canvas?.textContent).toContain("restart");
  });
});

describe("the expand button", () => {
  // The collection pane wins over the zoom (it is an overlay on top of the grid), so enlarging
  // from there sets a state nobody can see until they leave — a control that looks broken (#2001).
  it("drops the expand button where enlarging would do nothing visible", () => {
    const w = mount(CellChromeButtons, { props: { expanded: false, hideExpand: true } });
    expect(w.find('[aria-label="Expand terminal"]').exists()).toBe(false);
    expect(w.find('[aria-label="Close terminal"]').exists()).toBe(true); // and nothing else goes
  });

  // The flag is negative because Vue casts an absent boolean prop to `false` at every level it
  // passes through — a positive "expandable" was hidden for every caller that never mentions it,
  // which is most of them.
  it("keeps the expand button for a caller that says nothing", () => {
    expect(mountButtons().find('[aria-label="Expand terminal"]').exists()).toBe(true);
    expect(
      mount(CellChromeButtons, { props: { expanded: false, hideExpand: false } })
        .find('[aria-label="Expand terminal"]')
        .exists(),
    ).toBe(true);
  });
});

// #2007. The button belongs to a session terminal — the only cell that can be set aside — and the
// command and launcher cells reach these buttons through a binding that deliberately has no
// `toggle-park` key, so one rendered there clicks and does nothing.
//
// It was guarded on `parked !== undefined`, which cannot express "opt out by not passing it": Vue
// casts an ABSENT boolean prop to `false`, so the guard was true on every cell and the button
// shipped on all three from the day parking landed. Hence a prop of its own, and hence the first
// test here mounts with the prop MISSING rather than with `canPark: false` — false is what the
// broken version already had.
describe("the park button", () => {
  const parkButton = (props: Record<string, unknown>) => mount(CellChromeButtons, { props: { expanded: true, ...props } }).find(PARK);

  it("is absent when the caller says nothing about parking", () => {
    expect(parkButton({}).exists()).toBe(false);
    expect(parkButton({ canPark: false }).exists()).toBe(false);
  });

  // `parked` is the pressed state, not the permission: a cell that cannot park is not given the
  // button by being handed one.
  it("stays absent even if a parked flag arrives without it", () => {
    expect(parkButton({ parked: true }).exists()).toBe(false);
  });

  it("is there for a session terminal, on a tile as well as enlarged", () => {
    for (const expanded of [false, true]) expect(parkButton({ expanded, canPark: true }).exists()).toBe(true);
  });

  it("reads as pressed, and offers the way back, while the cell is set aside", () => {
    const awake = parkButton({ canPark: true, parked: false });
    expect(awake.attributes("aria-pressed")).toBe("false");
    expect(awake.attributes("data-tip")).toBe("Set aside (stays open, keeps its history)");

    const asleep = parkButton({ canPark: true, parked: true });
    expect(asleep.attributes("aria-pressed")).toBe("true");
    expect(asleep.attributes("data-tip")).toBe("Wake this terminal");
  });

  it("emits the intent and never acts on it, like its neighbours", async () => {
    const w = mount(CellChromeButtons, { props: { expanded: true, canPark: true } });
    await w.find(PARK).trigger("click");
    expect(w.emitted("toggle-park")).toHaveLength(1);
    expect(w.emitted("close")).toBeUndefined();
  });

  // Set aside, or end it — the reversible one must not sit past the one that tears a session down.
  // Expand / restore sits between them, beside close, where both change how much room the cell takes.
  it("sits before expand and close, which end the row", () => {
    // Read from the DOM: `findAll` lists a child component's buttons after the parent's own.
    const host = document.createElement("div");
    document.body.appendChild(host);
    mount(CellChromeButtons, { props: { expanded: true, canPark: true }, attachTo: host });
    const buttons = [...host.querySelectorAll<HTMLElement>(".cell-btn")];
    expect(buttons[buttons.length - 3].dataset.testid).toBe("cell-park-btn");
    expect(buttons[buttons.length - 2].getAttribute("aria-label")).toBe("Restore terminal");
    expect(buttons[buttons.length - 1].getAttribute("aria-label")).toBe("Close terminal");
  });

  // A person asleep in a bed: the moon it replaced read as a dark-mode switch (#2311).
  it("draws a person asleep, not a moon", () => {
    const w = mount(CellChromeButtons, { props: { expanded: false, canPark: true } });
    expect(w.get(PARK).text()).toBe("hotel");
  });

  // A filmstrip thumbnail: at its width the rest was cut off, and the thumbnail enlarges on a click.
  it("offers only close when told to, whatever else the cell could do", () => {
    const w = mount(CellChromeButtons, { props: { expanded: false, canPark: true, closeOnly: true } });
    expect(w.findAll("button").map((b) => b.attributes("aria-label"))).toEqual(["Close terminal"]);
  });
});

// A remote cell (#3506): every pane reads this machine's copy of the session, so neither menu is offered.
describe("CellChromeButtons on a remote cell", () => {
  it("drops the history and tools menus and keeps the cell controls", () => {
    const local = mount(CellChromeButtons, { props: { expanded: false } });
    expect(local.find('[data-testid="cell-history-btn"]').exists()).toBe(true);
    const remote = mount(CellChromeButtons, { props: { expanded: false, panesHidden: true, canPark: true } });
    expect(remote.find('[data-testid="cell-history-btn"]').exists()).toBe(false);
    expect(remote.find('[data-testid="cell-tools-btn"]').exists()).toBe(false);
    expect(remote.find(PARK).exists()).toBe(true);
    expect(remote.find('[aria-label="Close terminal"]').exists()).toBe(true);
  });

  // Restarting goes to the cell's own host now, so the tools menu stays for that action alone.
  it("keeps the tools menu for restart, with no pane in it", async () => {
    const remote = mount(CellChromeButtons, { props: { expanded: false, panesHidden: true, restartAvailable: true }, attachTo: document.body });
    const tools = remote.find('[data-testid="cell-tools-btn"]');
    expect(tools.exists()).toBe(true);
    await tools.trigger("click");
    // The menu is teleported to the body.
    const items = [...document.body.querySelectorAll('[data-testid^="cell-pane-menu-"]')].map((item) => item.getAttribute("data-testid"));
    expect(items).toEqual(["cell-pane-menu-restart"]);
    remote.unmount();
  });
});
