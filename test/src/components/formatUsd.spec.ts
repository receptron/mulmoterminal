import { describe, it, expect } from "vitest";

import { formatUsd } from "../../../src/components/formatUsd";

const CENT_USD = 0.01;

describe("formatUsd", () => {
  // Nothing loaded yet is not "$0.00" — the dash says "no figure", a zero says "cost is zero".
  it("shows a dash for an absent value", () => {
    expect(formatUsd(undefined)).toBe("—");
  });

  // A genuine zero cost is a real figure and reads as such.
  it("shows an exact zero as $0.00", () => {
    expect(formatUsd(0)).toBe("$0.00");
  });

  // A positive amount under a cent must not round down to "$0.00" — a real cost never renders
  // as no cost. The boundary is exactly one cent.
  it.each([
    [0.0001, "<$0.01"],
    [0.004, "<$0.01"],
    [0.009, "<$0.01"],
  ])("shows a sub-cent %d as <$0.01", (value, expected) => {
    expect(formatUsd(value)).toBe(expected);
  });

  it("shows exactly one cent as $0.01, not <$0.01", () => {
    expect(formatUsd(CENT_USD)).toBe("$0.01");
  });

  it.each([
    [1.5, "$1.50"],
    [12.3, "$12.30"],
    [1234.5, "$1234.50"],
  ])("shows %d as %s", (value, expected) => {
    expect(formatUsd(value)).toBe(expected);
  });

  // Two decimals, rounding the third.
  it.each([
    [1.005, "$1.00"],
    [1.006, "$1.01"],
    [1234.567, "$1234.57"],
  ])("rounds %d to two decimals as %s", (value, expected) => {
    expect(formatUsd(value)).toBe(expected);
  });

  // Deliberate asymmetry: the sub-cent rule guards only positive amounts (cost is never
  // negative in practice), so a negative slips straight to the plain formatter rather than
  // "<$0.01". Pinned so the guard is not "helpfully" widened to `Math.abs`.
  it("does not apply the sub-cent rule to negatives", () => {
    expect(formatUsd(-0.004)).toBe("$-0.00");
  });
});
