import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import CellChromeButtons from "../../../src/components/CellChromeButtons.vue";
import { CELL_BTN, CELL_CLOSE_BTN } from "../../../src/components/cellChromeClasses";

const mountButtons = (expanded = false) => mount(CellChromeButtons, { props: { expanded } });

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
    expect(expanded.find(".cell-btn").attributes("title")).toBe("Restore");
    expect(expanded.find('[aria-label="Restore terminal"]').exists()).toBe(true);
  });

  it("emits toggle-expand and close from their own buttons", async () => {
    const w = mountButtons();
    await w.find('[aria-label="Expand terminal"]').trigger("click");
    await w.find('[aria-label="Close terminal"]').trigger("click");
    expect(w.emitted("toggle-expand")).toHaveLength(1);
    expect(w.emitted("close")).toHaveLength(1);
  });
});

// The file pane splits the ENLARGED cell's room, so its toggle only exists there — a tiled
// cell or a filmstrip thumbnail has nowhere to put it.
describe("CellChromeButtons — the file pane toggle", () => {
  it("is absent until the cell is enlarged", () => {
    expect(mountButtons(false).find('[aria-label="Show files"]').exists()).toBe(false);
    expect(mountButtons(true).find('[aria-label="Show files"]').exists()).toBe(true);
  });

  it("reads as pressed, and renames itself, while the pane is open", () => {
    const open = mount(CellChromeButtons, { props: { expanded: true, filesOpen: true } });
    const btn = open.find('[aria-label="Hide files"]');
    expect(btn.exists()).toBe(true);
    expect(btn.attributes("aria-pressed")).toBe("true");
    expect(mountButtons(true).find('[aria-label="Show files"]').attributes("aria-pressed")).toBe("false");
  });

  it("emits the intent and never acts on it, like its neighbours", async () => {
    const w = mountButtons(true);
    await w.find('[aria-label="Show files"]').trigger("click");
    expect(w.emitted("toggle-files")).toHaveLength(1);
    expect(w.emitted("toggle-expand")).toBeUndefined();
  });

  // Expand/restore stays first: several specs and the grid select the first `.cell-btn`.
  it("sits after expand/restore, not before it", () => {
    const buttons = mountButtons(true).findAll(".cell-btn");
    expect(buttons[0].attributes("aria-label")).toBe("Restore terminal");
    expect(buttons[1].attributes("aria-label")).toBe("Show files");
  });
});

// The Canvas pane can only fill for a session whose directory registered the `render` MCP
// group. Absent, the pane opens empty — so the button stays and explains itself instead of
// disappearing, which would leave nothing to ask about.
describe("the canvas button", () => {
  const canvasButton = (props: Record<string, unknown>) =>
    mount(CellChromeButtons, { props: { expanded: true, ...props } }).find('[data-testid="cell-canvas-btn"]');

  it("is absent until the cell is enlarged (the pane needs the room)", () => {
    const w = mount(CellChromeButtons, { props: { expanded: false, canvasAvailable: true } });
    expect(w.find('[data-testid="cell-canvas-btn"]').exists()).toBe(false);
  });

  it("is enabled when the session has the render tools", () => {
    const btn = canvasButton({ canvasAvailable: true });
    expect(btn.exists()).toBe(true);
    expect(btn.attributes("disabled")).toBeUndefined();
    expect(btn.attributes("title")).toBe("Show canvas");
  });

  it("is present but disabled when it does not", () => {
    const btn = canvasButton({ canvasAvailable: false });
    expect(btn.exists()).toBe(true);
    expect(btn.attributes("disabled")).toBeDefined();
  });

  // A disabled control is exactly when someone asks why — so the title carries the fix, and
  // names the restart, which is easy to miss because every other dir setting applies live.
  it("says how to fix it, restart included", () => {
    const title = canvasButton({ canvasAvailable: false }).attributes("title") ?? "";
    expect(title).toContain("Canvas");
    expect(title).toContain("restart");
  });

  // Without `enabled:`-prefixed hovers a disabled button still lights up under the cursor and
  // reads as pressable.
  it("does not offer hover affordances while disabled", () => {
    expect(canvasButton({ canvasAvailable: false }).classes()).not.toContain("hover:bg-hover");
    expect(canvasButton({ canvasAvailable: false }).classes()).toContain("disabled:opacity-40");
  });

  it("reads as pressed while the canvas pane is the one showing", () => {
    expect(canvasButton({ canvasAvailable: true, rightPane: "canvas" }).attributes("aria-pressed")).toBe("true");
    expect(canvasButton({ canvasAvailable: true, rightPane: "files" }).attributes("aria-pressed")).toBe("false");
  });
});

// Files, Canvas and Tools share ONE slot beside the enlarged terminal, so which of the three is
// open is a choice the header has to show. It was carried only by `aria-pressed` and the tooltip
// — read by a screen reader, and by whoever happens to hover — while the three buttons looked
// identical to anyone just looking at them.
describe("the open pane's button, seen", () => {
  const header = (props: Record<string, unknown>) => mount(CellChromeButtons, { props: { expanded: true, canvasAvailable: true, ...props } });
  const button = (props: Record<string, unknown>, testid: string) => header(props).find(testid);
  const FILES = '[aria-label="Show files"], [aria-label="Hide files"]';
  const TOOLS = '[aria-label="Show tools"], [aria-label="Hide tools"]';
  const CANVAS = '[data-testid="cell-canvas-btn"]';
  const isMarked = (classes: string[]) => classes.includes("bg-selected") && classes.includes("text-accent");

  it("fills and recolours the button whose pane is open", () => {
    expect(isMarked(button({ rightPane: "files", filesOpen: true }, FILES).classes())).toBe(true);
    expect(isMarked(button({ rightPane: "canvas" }, CANVAS).classes())).toBe(true);
    expect(isMarked(button({ rightPane: "tools" }, TOOLS).classes())).toBe(true);
  });

  it("leaves the other two alone", () => {
    const w = header({ rightPane: "canvas" });
    expect(isMarked(w.find(FILES).classes())).toBe(false);
    expect(isMarked(w.find(TOOLS).classes())).toBe(false);
  });

  // The slot holds one pane, so two buttons marked at once would describe a layout that cannot
  // happen — and the user would have no way to tell which one the pane belongs to.
  it("marks exactly one at a time, and none when the slot is empty", () => {
    for (const pane of ["files", "canvas", "tools"]) {
      const w = header({ rightPane: pane, filesOpen: pane === "files" });
      expect(w.findAll("button").filter((b) => isMarked(b.classes()))).toHaveLength(1);
    }
    expect(
      header({ rightPane: null })
        .findAll("button")
        .filter((b) => isMarked(b.classes())),
    ).toHaveLength(0);
  });

  // Appending the pressed classes would leave `bg-transparent` on the element too, and which of
  // two competing utilities wins is Tailwind's output order rather than the order written here.
  it("swaps the idle fill out rather than layering over it", () => {
    expect(button({ rightPane: "tools" }, TOOLS).classes()).not.toContain("bg-transparent");
    expect(button({ rightPane: "files" }, TOOLS).classes()).toContain("bg-transparent");
  });
});
