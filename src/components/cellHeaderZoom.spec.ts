import { describe, it, expect } from "vitest";
import { shouldZoomOnHeaderClick } from "./cellHeaderZoom";

describe("shouldZoomOnHeaderClick", () => {
  it("zooms when a filmstrip thumbnail's header background (a non-button element) is clicked", () => {
    const span = document.createElement("span"); // e.g. the prompt / badge / dot
    expect(shouldZoomOnHeaderClick(span, true)).toBe(true);
  });

  it("does not zoom in the normal grid — only the ⤢ button zooms there", () => {
    const span = document.createElement("span");
    expect(shouldZoomOnHeaderClick(span, false)).toBe(false);
    expect(shouldZoomOnHeaderClick(null, false)).toBe(false);
  });

  it("ignores clicks that land on one of the header's own buttons (even on a thumbnail)", () => {
    const header = document.createElement("div");
    const btn = document.createElement("button");
    const icon = document.createElement("span"); // an icon inside the button
    btn.appendChild(icon);
    header.appendChild(btn);
    expect(shouldZoomOnHeaderClick(btn, true)).toBe(false);
    expect(shouldZoomOnHeaderClick(icon, true)).toBe(false); // click bubbles from the icon
  });

  it("ignores clicks on an SVG icon inside a button (e.g. the GitHub button)", () => {
    // SVGElement is not an HTMLElement — the target must still resolve to its button.
    const btn = document.createElement("button");
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    svg.appendChild(path);
    btn.appendChild(svg);
    expect(shouldZoomOnHeaderClick(svg, true)).toBe(false);
    expect(shouldZoomOnHeaderClick(path, true)).toBe(false);
  });

  it("zooms on a null / non-element target of a thumbnail (no button in the path)", () => {
    expect(shouldZoomOnHeaderClick(null, true)).toBe(true);
  });
});
