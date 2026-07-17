import { describe, it, expect } from "vitest";
import { shouldZoomOnHeaderClick } from "../../../src/components/cellHeaderZoom.js";

describe("shouldZoomOnHeaderClick", () => {
  it("zooms when a non-expanded cell's header background (a non-button element) is clicked", () => {
    const span = document.createElement("span"); // e.g. the prompt / badge / dot
    expect(shouldZoomOnHeaderClick(span, false)).toBe(true); // tiled grid or filmstrip thumbnail
  });

  it("does not zoom on the already-expanded cell — its header is inert (restore via ⤡)", () => {
    const span = document.createElement("span");
    expect(shouldZoomOnHeaderClick(span, true)).toBe(false);
    expect(shouldZoomOnHeaderClick(null, true)).toBe(false);
  });

  it("ignores clicks that land on one of the header's own buttons", () => {
    const header = document.createElement("div");
    const btn = document.createElement("button");
    const icon = document.createElement("span"); // an icon inside the button
    btn.appendChild(icon);
    header.appendChild(btn);
    expect(shouldZoomOnHeaderClick(btn, false)).toBe(false);
    expect(shouldZoomOnHeaderClick(icon, false)).toBe(false); // click bubbles from the icon
  });

  it("ignores clicks on an SVG icon inside a button (e.g. the GitHub button)", () => {
    // SVGElement is not an HTMLElement — the target must still resolve to its button.
    const btn = document.createElement("button");
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    svg.appendChild(path);
    btn.appendChild(svg);
    expect(shouldZoomOnHeaderClick(svg, false)).toBe(false);
    expect(shouldZoomOnHeaderClick(path, false)).toBe(false);
  });

  it("zooms on a null / non-element target of a non-expanded cell (no button in the path)", () => {
    expect(shouldZoomOnHeaderClick(null, false)).toBe(true);
  });
});
