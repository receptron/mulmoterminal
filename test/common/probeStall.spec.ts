// @vitest-environment node
import { describe, it, expect } from "vitest";
import { isProbeStall, PROBE_STALLS } from "../../common/probeStall";

describe("isProbeStall (#3291)", () => {
  it.each(PROBE_STALLS.map((stall) => [stall]))("accepts %j", (stall) => {
    expect(isProbeStall(stall)).toBe(true);
  });

  it.each([[undefined], [null], [""], ["Usage-limit"], ["usage-limit "], ["bogus"], [1], [{}]])("refuses %j", (value) => {
    expect(isProbeStall(value)).toBe(false);
  });
});
