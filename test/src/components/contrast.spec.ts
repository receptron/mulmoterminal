import { describe, it, expect } from "vitest";

import { contrastRatio, readableTextColor, relativeLuminance } from "../../../src/components/contrast";

const hex = (value: string): [number, number, number] => {
  const n = parseInt(value.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const ratioOn = (background: string, text: "#000" | "#fff") => contrastRatio(relativeLuminance(...hex(background)), text === "#000" ? 0 : 1);

describe("relativeLuminance", () => {
  it("is 0 for black and 1 for white", () => {
    expect(relativeLuminance(0, 0, 0)).toBe(0);
    expect(relativeLuminance(255, 255, 255)).toBeCloseTo(1, 10);
  });

  // Gamma-decoded, not raw: mid grey is far darker than half of white.
  it("gamma-decodes rather than averaging raw channels", () => {
    expect(relativeLuminance(128, 128, 128)).toBeCloseTo(0.2159, 3);
  });

  it("weights green far above blue", () => {
    expect(relativeLuminance(0, 255, 0)).toBeGreaterThan(relativeLuminance(0, 0, 255) * 5);
  });
});

describe("contrastRatio", () => {
  it("is 21 for black on white and 1 for a colour on itself", () => {
    expect(contrastRatio(0, 1)).toBeCloseTo(21, 10);
    expect(contrastRatio(0.5, 0.5)).toBe(1);
  });

  it("does not care which way round the two are given", () => {
    expect(contrastRatio(0.2, 0.8)).toBeCloseTo(contrastRatio(0.8, 0.2), 10);
  });
});

describe("readableTextColor", () => {
  it("puts dark text on white and light text on black", () => {
    expect(readableTextColor(255, 255, 255)).toBe("#000");
    expect(readableTextColor(0, 0, 0)).toBe("#fff");
  });

  // The case that motivated this (#308, and the boundary noted in #634): the old brightness
  // approximation scored pure green at 149.685 against a threshold of 150 and chose WHITE —
  // a contrast ratio of 1.37:1, effectively unreadable, where black gives 15.3:1.
  it("chooses black on vivid green, which the old rule got backwards", () => {
    expect(readableTextColor(...hex("#00ff00"))).toBe("#000");
    expect(ratioOn("#00ff00", "#000")).toBeGreaterThan(14);
    expect(ratioOn("#00ff00", "#fff")).toBeLessThan(1.5);
  });

  // A sample of real palette colours whose text colour the old rule chose badly.
  it.each([["#22c55e"], ["#ff0000"], ["#8c8c8c"], ["#00ff00"]])("meets WCAG AA on %s, which the old rule failed", (color) => {
    expect(ratioOn(color, readableTextColor(...hex(color)))).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps the colours the old rule already handled well", () => {
    expect(readableTextColor(...hex("#2563eb"))).toBe("#fff");
    expect(readableTextColor(...hex("#e0a52d"))).toBe("#000");
  });

  // The guarantee worth stating: black and white are 21:1 apart, so the better of the two is
  // never below 4.5:1 for any background whatsoever.
  it("never leaves a background below WCAG AA, across the colour space", () => {
    let worst = Infinity;
    for (let r = 0; r < 256; r += 17) {
      for (let g = 0; g < 256; g += 17) {
        for (let b = 0; b < 256; b += 17) {
          const background = relativeLuminance(r, g, b);
          const chosen = readableTextColor(r, g, b) === "#000" ? 0 : 1;
          worst = Math.min(worst, contrastRatio(background, chosen));
        }
      }
    }
    expect(worst).toBeGreaterThanOrEqual(4.5);
  });
});
