import { describe, it, expect } from "vitest";
import { PALETTE_ACTIONS, paletteRows, type PaletteText } from "../../../src/composables/commandPaletteRows";

// #2266. What the palette lists, how it ranks, and what it says about each row.
const TEXT: PaletteText = {
  label: (action) => `Label of ${action}`,
  description: (action) => `About ${action}`,
  needsEnlarged: "needs enlarged",
  needsNothingEnlarged: "not while enlarged",
};
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
    expect(paletteRows("", {}, true, TEXT).map((row) => row.action)).toEqual([...PALETTE_ACTIONS]);
  });

  it("finds an action by its id, and puts the closest first", () => {
    const [first] = paletteRows("find", {}, true, TEXT);
    expect(first?.action).toBe("files-find");
  });

  it("finds an action by its name", () => {
    const rows = paletteRows("restart", {}, true, { ...TEXT, label: (action) => (action === "terminal-restart" ? "Restart the agent" : "Other") });
    expect(rows[0]?.action).toBe("terminal-restart");
  });

  it("highlights only within the name, never in the id searched beside it", () => {
    const [row] = paletteRows("files-find", {}, true, { ...TEXT, label: () => "Open" });
    expect(row && labelText(row)).toBe("Open");
  });

  it("lists nothing for a query no action matches", () => {
    expect(paletteRows("zzzzqqq", {}, true, TEXT)).toEqual([]);
  });

  it("shows the binding as the user wrote it, and null when there is none", () => {
    const rows = paletteRows("", { "files-find": "Cmd+k p" }, true, TEXT);
    expect(rows.find((row) => row.action === "files-find")?.binding).toBe("Cmd+k p");
    expect(rows.find((row) => row.action === "zoom-toggle")?.binding).toBeNull();
  });

  it("says why an action cannot run in the current view", () => {
    const unzoomed = paletteRows("", {}, false, TEXT);
    expect(unzoomed.find((row) => row.action === "files-find")?.disabledReason).toBe("needs enlarged");
    expect(unzoomed.find((row) => row.action === "focus-next")?.disabledReason).toBeNull();
    const zoomed = paletteRows("", {}, true, TEXT);
    expect(zoomed.find((row) => row.action === "focus-next")?.disabledReason).toBe("not while enlarged");
    expect(zoomed.find((row) => row.action === "zoom-toggle")?.disabledReason).toBeNull();
  });

  it("carries each action's description", () => {
    expect(paletteRows("", {}, true, TEXT)[0]?.description).toBe(`About ${PALETTE_ACTIONS[0]}`);
  });
});
