import { describe, it, expect, vi, beforeEach } from "vitest";
import { APP_ACTIONS } from "../../../common/appActions";

// #2639. A toolbar operation by name: the same openers the toolbar and palette call, refused for a
// screen that is not set up or a view / order with no grid to change.
const m = vi.hoisted(() => ({
  openers: {} as Record<string, () => void>,
  gated: { prs: false, rooms: false, worklog: true },
  toggleSound: vi.fn(),
  reopen: vi.fn(() => true),
  toggle: vi.fn(() => true),
}));
vi.mock("../../../src/composables/paletteScreenOpeners", () => ({
  SCREEN_OPENERS: new Proxy(m.openers, { get: (target, key: string) => (target[key] ??= vi.fn()) }),
}));
vi.mock("../../../src/composables/useGatedEntries", () => ({ useGatedEntries: () => ({ value: m.gated }) }));
vi.mock("../../../src/composables/useSoundEnabled", () => ({ useSoundEnabled: () => ({ toggle: m.toggleSound }) }));
vi.mock("../../../src/composables/reopenClosedCell", () => ({ reopenLastClosedCell: m.reopen }));
vi.mock("../../../src/composables/screenToggle", () => ({ toggleLastScreen: m.toggle }));

import { runAppAction } from "../../../src/composables/runAppAction";
import { paletteGridView } from "../../../src/composables/commandPalette";
import { settingsOpen } from "../../../src/composables/settingsOpener";

const grid = {
  listMode: vi.fn(() => true),
  toggleListMode: vi.fn(),
  sortMode: vi.fn(() => "auto" as const),
  setSortMode: vi.fn(),
  stepPage: vi.fn(() => true),
};

beforeEach(() => {
  vi.clearAllMocks();
  paletteGridView.value = null;
  settingsOpen.value = false;
});

describe("runAppAction", () => {
  it("opens a screen through the toolbar's own opener", () => {
    expect(runAppAction("screen-wiki")).toBe(true);
    expect(m.openers.wiki).toHaveBeenCalledTimes(1);
    expect(runAppAction("screen-worklog")).toBe(true);
    expect(m.openers.worklog).toHaveBeenCalledTimes(1);
    expect(runAppAction("screen-skills")).toBe(true);
    expect(m.openers.skills).toHaveBeenCalledTimes(1);
    expect(runAppAction("screen-library")).toBe(true);
    expect(m.openers.library).toHaveBeenCalledTimes(1);
    expect(runAppAction("screen-processes")).toBe(true);
    expect(m.openers.processes).toHaveBeenCalledTimes(1);
    expect(runAppAction("screen-usage")).toBe(true);
    expect(m.openers.usage).toHaveBeenCalledTimes(1);
  });

  it("toggles to and from the last screen, and passes a refusal on", () => {
    expect(runAppAction("screen-toggle")).toBe(true);
    m.toggle.mockReturnValueOnce(false);
    expect(runAppAction("screen-toggle")).toBe(false);
    expect(m.toggle).toHaveBeenCalledTimes(2);
  });

  it("refuses a screen whose feature is not set up, opening nothing", () => {
    expect(runAppAction("screen-prs")).toBe(false);
    expect(runAppAction("screen-rooms")).toBe(false);
    expect(m.openers.prs ?? vi.fn()).not.toHaveBeenCalled();
    expect(m.openers.rooms ?? vi.fn()).not.toHaveBeenCalled();
  });

  it("opens Settings and toggles the sound", () => {
    expect(runAppAction("settings-open")).toBe(true);
    expect(settingsOpen.value).toBe(true);
    expect(runAppAction("sound-toggle")).toBe(true);
    expect(m.toggleSound).toHaveBeenCalledTimes(1);
  });

  it("switches the view and the order on the grid, and declines with no grid", () => {
    expect(runAppAction("view-toggle")).toBe(false);
    expect(runAppAction("order-manual")).toBe(false);
    paletteGridView.value = grid;
    expect(runAppAction("view-toggle")).toBe(true);
    expect(grid.toggleListMode).toHaveBeenCalledTimes(1);
    expect(runAppAction("order-priority")).toBe(true);
    expect(grid.setSortMode).toHaveBeenCalledWith("priority");
  });

  it("steps the grid's page, and passes the grid's refusal at either end on", () => {
    expect(runAppAction("page-next")).toBe(false); // no grid
    paletteGridView.value = grid;
    expect(runAppAction("page-next")).toBe(true);
    expect(grid.stepPage).toHaveBeenLastCalledWith(1);
    grid.stepPage.mockReturnValueOnce(false);
    expect(runAppAction("page-prev")).toBe(false);
    expect(grid.stepPage).toHaveBeenLastCalledWith(-1);
  });

  // #2800. Needs no grid: the reopened cell is queued for it, and the grid is shown.
  it("reopens the last closed cell, and passes a refusal on", () => {
    expect(runAppAction("terminal-reopen")).toBe(true);
    expect(m.reopen).toHaveBeenCalledTimes(1);
    m.reopen.mockReturnValueOnce(false);
    expect(runAppAction("terminal-reopen")).toBe(false);
  });

  it("answers every app action", () => {
    paletteGridView.value = grid;
    m.gated.prs = true;
    m.gated.rooms = true;
    APP_ACTIONS.forEach((action) => expect(runAppAction(action), action).toBe(true));
    m.gated.prs = false;
    m.gated.rooms = false;
  });
});
