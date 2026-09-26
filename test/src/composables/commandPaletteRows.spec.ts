import { describe, it, expect } from "vitest";
import { PALETTE_ACTIONS, paletteRows, type PaletteText } from "../../../src/composables/commandPaletteRows";

// #2266. What the palette lists, how it ranks, and what it says about each row.
const TEXT: PaletteText = {
  label: (action) => `Label of ${action}`,
  description: (action) => `About ${action}`,
  needsEnlarged: "needs enlarged",
  needsNothingEnlarged: "not while enlarged",
  gridHidden: "grid hidden",
};
const ZOOMED = { zoomed: true, available: true };
const UNZOOMED = { zoomed: false, available: true };
const labelText = (row: { label: { text: string }[] }) => row.label.map((part) => part.text).join("");

describe("PALETTE_ACTIONS", () => {
  it("leaves out copy, paste and the palette itself", () => {
    expect(PALETTE_ACTIONS).not.toContain("copy");
    expect(PALETTE_ACTIONS).not.toContain("paste");
    expect(PALETTE_ACTIONS).not.toContain("command-palette");
    expect(PALETTE_ACTIONS).toContain("files-find");
  });
});

describe("paletteRows", () => {
  it("lists every action in order when nothing is typed", () => {
    expect(paletteRows("", {}, ZOOMED, TEXT).map((row) => row.action)).toEqual([...PALETTE_ACTIONS]);
  });

  it("finds an action by its id, and puts the closest first", () => {
    const [first] = paletteRows("find", {}, ZOOMED, TEXT);
    expect(first?.action).toBe("files-find");
  });

  it("finds an action by its name", () => {
    const rows = paletteRows("restart", {}, ZOOMED, { ...TEXT, label: (action) => (action === "terminal-restart" ? "Restart the agent" : "Other") });
    expect(rows[0]?.action).toBe("terminal-restart");
  });

  it("highlights only within the name, never in the id searched beside it", () => {
    const [row] = paletteRows("files-find", {}, ZOOMED, { ...TEXT, label: () => "Open" });
    expect(row && labelText(row)).toBe("Open");
  });

  it("lists nothing for a query no action matches", () => {
    expect(paletteRows("zzzzqqq", {}, ZOOMED, TEXT)).toEqual([]);
  });

  it("shows the binding as the user wrote it, and null when there is none", () => {
    const rows = paletteRows("", { "files-find": "Cmd+k p" }, ZOOMED, TEXT);
    expect(rows.find((row) => row.action === "files-find")?.binding).toBe("Cmd+k p");
    expect(rows.find((row) => row.action === "zoom-toggle")?.binding).toBeNull();
  });

  it("says why an action cannot run in the current view", () => {
    const unzoomed = paletteRows("", {}, UNZOOMED, TEXT);
    expect(unzoomed.find((row) => row.action === "files-find")?.disabledReason).toBe("needs enlarged");
    expect(unzoomed.find((row) => row.action === "focus-next")?.disabledReason).toBeNull();
    const zoomed = paletteRows("", {}, ZOOMED, TEXT);
    expect(zoomed.find((row) => row.action === "focus-next")?.disabledReason).toBe("not while enlarged");
    expect(zoomed.find((row) => row.action === "zoom-toggle")?.disabledReason).toBeNull();
  });

  it("carries each action's description", () => {
    expect(paletteRows("", {}, ZOOMED, TEXT)[0]?.description).toBe(`About ${PALETTE_ACTIONS[0]}`);
  });

  // Over another view or the launch panel the grid takes no keys, and a pick would act on a grid
  // nobody is looking at (codex on #2286).
  it("disables every row while the grid is not in front", () => {
    const rows = paletteRows("", {}, { zoomed: true, available: false }, TEXT);
    expect(rows.every((row) => row.disabledReason === "grid hidden")).toBe(true);
  });
});
