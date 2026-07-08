import { describe, it, expect } from "vitest";
import { sanitizeButtons, sanitizeChips, sanitizeHeaderConfig, mergeHeaderConfig, type HeaderConfig } from "./header-config.js";

describe("sanitizeButtons", () => {
  it("keeps a valid shell/input/open button with its matching payload", () => {
    const out = sanitizeButtons([
      { id: "lint", label: "Lint", run: "shell", cmd: "yarn lint" },
      { id: "c", label: "Compact", run: "input", text: "/compact" },
      { id: "gh", label: "GH", run: "open", open: { url: "https://x" } },
    ]);
    expect(out.map((b) => b.id)).toEqual(["lint", "c", "gh"]);
    expect(out[2].open).toEqual({ url: "https://x" });
  });

  it("drops a button missing id/label/run or with a mismatched payload", () => {
    expect(sanitizeButtons([{ label: "x", run: "shell", cmd: "y" }])).toEqual([]); // no id
    expect(sanitizeButtons([{ id: "a", label: "x", run: "shell" }])).toEqual([]); // shell without cmd
    expect(sanitizeButtons([{ id: "a", label: "x", run: "input" }])).toEqual([]); // input without text
    expect(sanitizeButtons([{ id: "a", label: "x", run: "nope", cmd: "y" }])).toEqual([]); // bad run
  });

  it("dedupes by id (first wins) and only keeps known open view targets", () => {
    const out = sanitizeButtons([
      { id: "a", label: "A", run: "shell", cmd: "1" },
      { id: "a", label: "A2", run: "shell", cmd: "2" },
      { id: "v", label: "V", run: "open", open: { view: "bogus" } },
      { id: "w", label: "W", run: "open", open: { view: "diff" } },
    ]);
    expect(out.map((b) => b.id)).toEqual(["a", "w"]); // dup 'a' collapsed, bogus-view 'v' dropped
    expect(out[0].label).toBe("A");
  });

  it("returns [] for non-array input", () => {
    expect(sanitizeButtons(undefined)).toEqual([]);
    expect(sanitizeButtons({})).toEqual([]);
  });
});

describe("sanitizeChips", () => {
  it("returns null when chips is absent or not an array (unconfigured = use default)", () => {
    expect(sanitizeChips(undefined)).toBeNull();
    expect(sanitizeChips("dir")).toBeNull();
  });

  it("keeps built-in ids, drops unknown strings, keeps custom {label,text}", () => {
    expect(sanitizeChips(["dir", "git", "bogus", { label: "↑↓", text: "${ahead}" }])).toEqual(["dir", "git", { label: "↑↓", text: "${ahead}" }]);
  });

  it("keeps an empty array as configured-but-empty (hide all built-ins)", () => {
    expect(sanitizeChips([])).toEqual([]);
  });

  it("drops a custom chip missing label, missing text, or with empty text", () => {
    expect(sanitizeChips([{ label: "x" }, { text: "y" }, { label: "z", text: "" }])).toEqual([]);
  });
});

describe("sanitizeHeaderConfig", () => {
  it("assembles buttons + chips, defaulting a non-object to empty/null", () => {
    expect(sanitizeHeaderConfig(null)).toEqual({ buttons: [], chips: null });
    expect(sanitizeHeaderConfig({ buttons: [{ id: "a", label: "A", run: "shell", cmd: "x" }], chips: ["dir"] })).toEqual({
      buttons: [{ id: "a", label: "A", run: "shell", cmd: "x" }],
      chips: ["dir"],
    });
  });
});

describe("mergeHeaderConfig", () => {
  const g: HeaderConfig = {
    buttons: [
      { id: "shared", label: "G", run: "shell", cmd: "g" },
      { id: "gonly", label: "GO", run: "shell", cmd: "go" },
    ],
    chips: ["dir", "git"],
  };

  it("lets the project override a button by id and add its own", () => {
    const p: HeaderConfig = {
      buttons: [
        { id: "shared", label: "P", run: "shell", cmd: "p" },
        { id: "ponly", label: "PO", run: "shell", cmd: "po" },
      ],
      chips: null,
    };
    const out = mergeHeaderConfig(g, p);
    expect(out.buttons.map((b) => `${b.id}:${b.label}`).sort()).toEqual(["gonly:GO", "ponly:PO", "shared:P"]);
  });

  it("orders by `order` (undefined last), stable within equal order", () => {
    const out = mergeHeaderConfig(
      {
        buttons: [
          { id: "a", label: "A", run: "shell", cmd: "x", order: 20 },
          { id: "b", label: "B", run: "shell", cmd: "x" },
        ],
        chips: null,
      },
      { buttons: [{ id: "c", label: "C", run: "shell", cmd: "x", order: 10 }], chips: null },
    );
    expect(out.buttons.map((b) => b.id)).toEqual(["c", "a", "b"]);
  });

  it("takes the project's chips when set, else the global's, and passes null through", () => {
    expect(mergeHeaderConfig(g, { buttons: [], chips: ["ctx"] }).chips).toEqual(["ctx"]);
    expect(mergeHeaderConfig(g, { buttons: [], chips: null }).chips).toEqual(["dir", "git"]);
    expect(mergeHeaderConfig({ buttons: [], chips: null }, { buttons: [], chips: null }).chips).toBeNull();
  });
});
