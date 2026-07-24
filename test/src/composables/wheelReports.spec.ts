import { describe, expect, it } from "vitest";

import { clearResetModes, recordSwallowedModes, wantsWheelReports, wheelReportSequence } from "../../../src/composables/wheelReports";

// Claude Code's actual request: drag tracking + SGR encoding in one SET.
const CLAUDE_SET: (number | number[])[] = [1002, 1006];

describe("recordSwallowedModes / clearResetModes", () => {
  it("remembers a swallowed set and forgets it on reset", () => {
    const active = new Set<number>();
    recordSwallowedModes(active, CLAUDE_SET);
    expect(wantsWheelReports(active)).toBe(true);
    clearResetModes(active, CLAUDE_SET);
    expect(wantsWheelReports(active)).toBe(false);
  });

  it("reads the mode from a sub-parameter param", () => {
    const active = new Set<number>();
    recordSwallowedModes(active, [[1000, 4], 1006]);
    expect(wantsWheelReports(active)).toBe(true);
  });

  it("keeps wanting wheel reports while any tracking mode is still set", () => {
    const active = new Set<number>();
    recordSwallowedModes(active, [1000, 1002, 1006]);
    clearResetModes(active, [1002]);
    expect(wantsWheelReports(active)).toBe(true);
    clearResetModes(active, [1000]);
    expect(wantsWheelReports(active)).toBe(false);
  });

  it("ignores a reset for a mode that was never recorded", () => {
    const active = new Set<number>();
    clearResetModes(active, [1002, 1006]);
    expect(active.size).toBe(0);
  });
});

describe("wantsWheelReports", () => {
  it("requires the SGR encoding: tracking alone is not enough", () => {
    const active = new Set([1002]);
    expect(wantsWheelReports(active)).toBe(false);
  });

  it("requires a tracking mode: SGR alone is not enough", () => {
    const active = new Set([1006]);
    expect(wantsWheelReports(active)).toBe(false);
  });

  it("is false for an empty record and for unrelated modes", () => {
    expect(wantsWheelReports(new Set())).toBe(false);
    expect(wantsWheelReports(new Set([25, 1049]))).toBe(false);
  });

  it("accepts every wheel-capable tracking mode with SGR", () => {
    [1000, 1001, 1002, 1003].forEach((mode) => {
      expect(wantsWheelReports(new Set([mode, 1006]))).toBe(true);
    });
  });
});

describe("wheelReportSequence", () => {
  it("encodes wheel-up as button 64 and wheel-down as 65", () => {
    expect(wheelReportSequence(-1, 1, 1)).toBe("\x1b[<64;1;1M");
    expect(wheelReportSequence(120, 1, 1)).toBe("\x1b[<65;1;1M");
  });

  it("embeds the cell coordinates", () => {
    expect(wheelReportSequence(3, 12, 40)).toBe("\x1b[<65;12;40M");
  });

  it("returns null when there is no vertical motion", () => {
    expect(wheelReportSequence(0, 1, 1)).toBeNull();
  });
});
