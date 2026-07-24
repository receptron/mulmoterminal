import { describe, it, expect, vi } from "vitest";
import { mount, DOMWrapper } from "@vue/test-utils";
import { nextTick } from "vue";
import TerminalGrid, { type CockpitRow } from "../../../src/components/TerminalGrid.vue";
import type { Cell } from "../../../src/components/gridTabs.js";
import type { RunCommand } from "../../../src/components/runCommand.js";

// Stub the cells so the page renderer can be tested without Terminal/xterm/pub-sub.
vi.mock("../../../src/components/TerminalCell.vue", () => ({
  default: {
    name: "TerminalCell",
    props: ["expanded", "initialSessionId", "initialCwd", "defaultCwd", "presets", "home", "openSessionIds", "cancellable", "reorderable"],
    emits: ["toggle-expand", "session", "cwd", "run", "close", "move", "status"],
    template: '<div class="stub-cell" />',
  },
}));
vi.mock("../../../src/components/CommandCell.vue", () => ({
  default: {
    name: "CommandCell",
    props: ["expanded", "command", "home", "reorderable"],
    emits: ["toggle-expand", "close", "move", "status"],
    template: '<div class="stub-command-cell" />',
  },
}));
vi.mock("../../../src/components/LauncherCell.vue", () => ({
  default: {
    name: "LauncherCell",
    props: ["uid", "expanded", "launcher", "session", "cwd", "home", "reorderable"],
    emits: ["toggle-expand", "close", "move", "status", "session"],
    template: '<div class="stub-launcher-cell" />',
  },
}));

const cell = (uid: number, session: string | null = null, cwd: string | null = null): Cell => ({ uid, session, cwd });
const cmdCell = (uid: number, command: NonNullable<Cell["command"]>): Cell => ({ uid, session: null, cwd: null, command });
const mountGrid = (cells: Cell[], expandedUid: number | null = null, cancelUid: number | null = null, reorderable = false) =>
  mount(TerminalGrid, {
    props: {
      cells,
      expandedUid,
      listRows: [],
      cancelUid,
      defaultCwd: "/work",
      presets: [],
      launchers: [],
      home: "/work",
      openSessionIds: [],
      openCwds: [],
      reorderable,
      listMode: true,
    },
  });
const cellsOf = (w: ReturnType<typeof mount>) => w.findAllComponents({ name: "TerminalCell" });
const commandCellsOf = (w: ReturnType<typeof mount>) => w.findAllComponents({ name: "CommandCell" });

const rosterRow = (uid: number, over: Partial<CockpitRow> = {}): CockpitRow => ({
  uid,
  cwd: "/work",
  agent: "claude",
  status: "idle",
  summary: null,
  prompt: null,
  response: null,
  fallback: null,
  phase: "none",
  workPhase: null,
  headerColor: null,
  headerTextColor: null,
  ...over,
});
const mountCockpit = (cells: Cell[], expandedUid: number, listRows: CockpitRow[], reorderable = false, listMode = true) =>
  mount(TerminalGrid, {
    props: {
      cells,
      expandedUid,
      listRows,
      cancelUid: null,
      defaultCwd: "/work",
      presets: [],
      launchers: [],
      home: "/work",
      openSessionIds: [],
      openCwds: [],
      reorderable,
      listMode,
    },
  });

describe("TerminalGrid (page renderer)", () => {
  it("renders one TerminalCell per cell", () => {
    expect(cellsOf(mountGrid([cell(0), cell(1), cell(2)]))).toHaveLength(3);
  });

  it("passes session / cwd / expanded through to the cells", () => {
    const cs = cellsOf(mountGrid([cell(0, "s0", "/a"), cell(1, "s1", "/b")], 1));
    expect(cs[0].props("initialSessionId")).toBe("s0");
    expect(cs[0].props("expanded")).toBe(false);
    expect(cs[1].props("expanded")).toBe(true);
  });

  it("re-emits each cell event tagged with the cell uid", () => {
    const w = mountGrid([cell(7, "s")]);
    cellsOf(w)[0].vm.$emit("session", "new");
    cellsOf(w)[0].vm.$emit("cwd", "/x");
    cellsOf(w)[0].vm.$emit("close");
    cellsOf(w)[0].vm.$emit("toggle-expand");
    expect(w.emitted("session")?.[0]).toEqual([7, "new"]);
    expect(w.emitted("cwd")?.[0]).toEqual([7, "/x"]);
    expect(w.emitted("close")?.[0]).toEqual([7]);
    expect(w.emitted("toggle-expand")?.[0]).toEqual([7]);
  });

  it("marks only the cell matching cancelUid as cancellable", () => {
    const cs = cellsOf(mountGrid([cell(0, "s0"), cell(1)], null, 1));
    expect(cs[0].props("cancellable")).toBe(false);
    expect(cs[1].props("cancellable")).toBe(true);
  });

  it("passes reorderable through and re-emits move/status tagged with uid", () => {
    const w = mountGrid([cell(7, "s")], null, null, true);
    expect(cellsOf(w)[0].props("reorderable")).toBe(true);
    cellsOf(w)[0].vm.$emit("move", 1);
    cellsOf(w)[0].vm.$emit("status", "waiting");
    expect(w.emitted("move")?.[0]).toEqual([7, 1]);
    expect(w.emitted("status")?.[0]).toEqual([7, "waiting"]);
  });

  it("puts a ⋮ reorder menu on cockpit rows only in manual mode, emitting move tagged with uid", async () => {
    const cells = [cell(0, "s0"), cell(1, "s1"), cell(2)]; // two running + a trailing launch cell
    const rows = [rosterRow(0), rosterRow(1)];
    // auto mode (reorderable = false): the roster renders but carries no ⋮
    const auto = mountCockpit(cells, 0, rows);
    await nextTick();
    expect(auto.findAll('[data-testid="cockpit-row"]')).toHaveLength(2); // roster is shown
    expect(auto.find('[data-testid="cockpit-reorder"]').exists()).toBe(false);
    // manual mode: a ⋮ per row, and moving the 2nd row up emits move tagged with its uid
    const w = mountCockpit(cells, 0, rows, true);
    await nextTick();
    const kebabs = w.findAll('[data-testid="cockpit-reorder"]');
    expect(kebabs).toHaveLength(2);
    await kebabs[1].trigger("click");
    // the dropdown is teleported to <body>, so reach it through the document
    await new DOMWrapper(document.querySelector('[data-testid="reorder-up"]') as Element).trigger("click");
    expect(w.emitted("move")?.[0]).toEqual([1, -1]);
    w.unmount();
  });

  it("adds the zoomed class only when a cell is expanded", async () => {
    expect(
      mountGrid([cell(0, "s")], null)
        .find(".stage")
        .classes(),
    ).not.toContain("zoomed");
    const w = mountGrid([cell(0, "s")], 0);
    await nextTick();
    expect(w.find(".stage").classes()).toContain("zoomed");
  });
});

describe("TerminalGrid command cells", () => {
  const CMD: RunCommand = { source: "script", index: 1, label: "Dev server", cwd: "/work/proj" };

  it("renders a CommandCell (not a TerminalCell) for a cell carrying a command", () => {
    const w = mountGrid([cmdCell(3, CMD)]);
    expect(cellsOf(w)).toHaveLength(0);
    expect(commandCellsOf(w)).toHaveLength(1);
    expect(commandCellsOf(w)[0].props("command")).toEqual(CMD);
    expect(commandCellsOf(w)[0].props("home")).toBe("/work");
  });

  it("renders a command cell beside a session cell", () => {
    const w = mountGrid([cell(0, "s0"), cmdCell(1, CMD)]);
    expect(cellsOf(w)).toHaveLength(1);
    expect(commandCellsOf(w)).toHaveLength(1);
  });

  it("re-emits 'run' from a launcher tagged with the cell uid", () => {
    const w = mountGrid([cell(7)]);
    cellsOf(w)[0].vm.$emit("run", CMD);
    expect(w.emitted("run")?.[0]).toEqual([7, CMD]);
  });

  it("re-emits close / toggle-expand from a command cell tagged with uid", () => {
    const w = mountGrid([cmdCell(4, CMD)]);
    commandCellsOf(w)[0].vm.$emit("close");
    commandCellsOf(w)[0].vm.$emit("toggle-expand");
    expect(w.emitted("close")?.[0]).toEqual([4]);
    expect(w.emitted("toggle-expand")?.[0]).toEqual([4]);
  });
});

describe("active-cell focus zoom", () => {
  const focus = (w: ReturnType<typeof mount>, uid: number) => w.get(`[data-uid="${uid}"]`).element.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
  const cls = (w: ReturnType<typeof mount>, uid: number) => w.get(`[data-uid="${uid}"]`).classes();

  it("marks only the focused cell, and moves the mark when another cell takes focus", async () => {
    const w = mountGrid([cell(0, "s0"), cell(1, "s1")]);
    focus(w, 0);
    await nextTick();
    expect(cls(w, 0)).toContain("focused");
    expect(cls(w, 1)).not.toContain("focused");

    focus(w, 1);
    await nextTick();
    expect(cls(w, 0)).not.toContain("focused"); // the emphasis is single-source-of-truth
    expect(cls(w, 1)).toContain("focused");
  });

  it("stays sticky: focus leaving the grid does not clear it", async () => {
    const w = mountGrid([cell(0, "s0"), cell(1, "s1")]);
    focus(w, 0);
    await nextTick();
    // A focusin whose target is outside any cell (e.g. the toolbar) must not move the mark.
    document.body.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    await nextTick();
    expect(cls(w, 0)).toContain("focused");
  });

  it("does not zoom while a cell is expanded (filmstrip owns the emphasis)", async () => {
    const w = mountGrid([cell(0, "s0"), cell(1, "s1")], 0);
    focus(w, 1);
    await nextTick();
    expect(cls(w, 1)).not.toContain("focused");
  });
});

describe("grid cockpit (list view)", () => {
  it("shows the roster in list mode and the thumbnail strip otherwise (driven by the listMode prop)", async () => {
    const w = mountCockpit([cell(0, "s0"), cell(1, "s1")], 0, [rosterRow(0), rosterRow(1)]);
    await nextTick();
    expect(w.find('[data-testid="cockpit"]').exists()).toBe(true);
    expect(w.find(".stage").classes()).toContain("listmode");
    expect(w.findAll('[data-testid="cockpit-row"]')).toHaveLength(2);

    await w.setProps({ listMode: false });
    expect(w.find('[data-testid="cockpit"]').exists()).toBe(false); // roster gone
    expect(w.find(".stage").classes()).not.toContain("listmode"); // filmstrip mode
  });

  it("keeps roster rows full-height (shrink-0) so a long list scrolls instead of squishing (#722)", async () => {
    const many = Array.from({ length: 6 }, (_, i) => cell(i, `s${i}`));
    const w = mountCockpit(
      many,
      0,
      many.map((_, i) => rosterRow(i)),
    );
    await nextTick();
    // The roster is a bounded flex-col scroll container...
    expect(w.get('[data-testid="cockpit"]').classes()).toContain("overflow-y-auto");
    // ...and each row refuses to shrink, so the list overflows (scrolls) rather than cramming.
    for (const row of w.findAll('[data-testid="cockpit-row"]')) expect(row.classes()).toContain("shrink-0");
  });

  it("emits toggle-expand when a NON-active row is clicked, and not for the active one", async () => {
    const w = mountCockpit([cell(0, "s0"), cell(1, "s1")], 0, [rosterRow(0), rosterRow(1)]);
    await nextTick();
    const rows = w.findAll('[data-testid="cockpit-row"]');
    await rows[1].trigger("click"); // uid 1, not the expanded (0)
    expect(w.emitted("toggle-expand")?.[0]).toEqual([1]);
    await rows[0].trigger("click"); // uid 0 IS the expanded one — no-op
    expect(w.emitted("toggle-expand")).toHaveLength(1);
  });

  it("falls back to the running program's label when a row has no prompt or summary", async () => {
    const w = mountCockpit([cell(0, "s0")], 0, [rosterRow(0, { summary: null, prompt: null, fallback: "bash" })]);
    await nextTick();
    const lines = w.findAll('[data-testid="cockpit-line"]').map((l) => l.text());
    expect(lines.some((t) => t.includes("summary"))).toBe(false); // no summary line
    expect(lines.some((t) => t.includes("prompt") && t.includes("bash"))).toBe(true); // fallback in the prompt line
  });

  it("renders a PR-phase badge with the phase label and class", async () => {
    const w = mountCockpit([cell(0, "s0")], 0, [rosterRow(0, { phase: "ready" })]);
    await nextTick();
    const badge = w.find('[data-testid="cockpit-phase"]');
    expect(badge.exists()).toBe(true);
    expect(badge.text()).toBe("ready");
    expect(badge.classes()).toContain("ph-ready");
  });

  it("shows no phase badge for a cell with no PR yet (phase none)", async () => {
    const w = mountCockpit([cell(0, "s0")], 0, [rosterRow(0, { phase: "none" })]);
    await nextTick();
    expect(w.find('[data-testid="cockpit-phase"]').exists()).toBe(false);
  });

  it("colours a row's header bar with its directory's configured header colour", async () => {
    const w = mountCockpit([cell(0, "s0")], 0, [rosterRow(0, { headerColor: "#123456", headerTextColor: "#abcdef" })]);
    await nextTick();
    const header = w.find('[data-testid="cockpit-header"]').attributes("style") ?? "";
    expect(header).toContain("--cell-header-bg: #123456");
    expect(header).toContain("--cell-header-fg: #abcdef");
    // Only the header bar is tinted — the row body stays on the theme default.
    const row = w.find('[data-testid="cockpit-row"]').attributes("style") ?? "";
    expect(row).not.toContain("--cell-header-bg");
  });

  it("leaves the header bar transparent when its directory sets no header colour", async () => {
    const w = mountCockpit([cell(0, "s0")], 0, [rosterRow(0, { headerColor: null, headerTextColor: null })]);
    await nextTick();
    const header = w.find('[data-testid="cockpit-header"]').attributes("style") ?? "";
    expect(header).not.toContain("--cell-header-bg");
  });

  it.each([
    ["planning", "planning"],
    ["implementing", "editing"],
  ] as const)("refines a working cell's status word to %s → %s", async (workPhase, word) => {
    const w = mountCockpit([cell(0, "s0")], 0, [rosterRow(0, { status: "working", workPhase })]);
    await nextTick();
    expect(w.find('[data-testid="cockpit-badge"]').text()).toBe(word);
  });

  it("shows the plain status word for a working cell whose sub-phase is unknown", async () => {
    const w = mountCockpit([cell(0, "s0")], 0, [rosterRow(0, { status: "working", workPhase: null })]);
    await nextTick();
    expect(w.find('[data-testid="cockpit-badge"]').text()).toBe("running");
  });

  it("ignores workPhase for a non-working cell (idle stays idle)", async () => {
    const w = mountCockpit([cell(0, "s0")], 0, [rosterRow(0, { status: "idle", workPhase: "implementing" })]);
    await nextTick();
    expect(w.find('[data-testid="cockpit-badge"]').text()).toBe("idle");
  });
});
