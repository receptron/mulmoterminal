import { describe, it, expect, vi } from "vitest";
import { TERMINAL_SCROLL_SPEED_DEFAULT, TERMINAL_SCROLL_SPEED_MAX, TERMINAL_SCROLL_SPEED_MIN } from "../../../common/terminalScrollSpeed";

const STORAGE_KEY = "terminalScrollSpeed";

// The startup value is read once at module load, so each case needs a fresh module.
const startupSpeedWith = async (stored: string | null) => {
  localStorage.clear();
  if (stored !== null) localStorage.setItem(STORAGE_KEY, stored);
  vi.resetModules();
  const { useTerminalScrollSpeed } = await import("../../../src/composables/useTerminalScrollSpeed");
  return useTerminalScrollSpeed().scrollSpeed.value;
};

describe("useTerminalScrollSpeed startup value", () => {
  it("adopts a stored speed", async () => {
    expect(await startupSpeedWith("0.5")).toBe(0.5);
  });

  it("falls back to the default when nothing is stored", async () => {
    expect(await startupSpeedWith(null)).toBe(TERMINAL_SCROLL_SPEED_DEFAULT);
  });

  // `Number("")` is 0 — finite — so a blank value would clamp to the minimum instead of falling
  // back, which is what the font size shipped with until it was fixed.
  it("treats a blank stored value as unset rather than as zero", async () => {
    expect(await startupSpeedWith("")).toBe(TERMINAL_SCROLL_SPEED_DEFAULT);
    expect(await startupSpeedWith("   ")).toBe(TERMINAL_SCROLL_SPEED_DEFAULT);
  });

  it("falls back for a non-numeric stored value", async () => {
    expect(await startupSpeedWith("abc")).toBe(TERMINAL_SCROLL_SPEED_DEFAULT);
  });

  it("clamps a stored speed that is out of range", async () => {
    expect(await startupSpeedWith("99")).toBe(TERMINAL_SCROLL_SPEED_MAX);
    expect(await startupSpeedWith("0.01")).toBe(TERMINAL_SCROLL_SPEED_MIN);
  });
});

describe("useTerminalScrollSpeed updates", () => {
  const fresh = async () => {
    localStorage.clear();
    vi.resetModules();
    const { useTerminalScrollSpeed, getTerminalScrollSpeed } = await import("../../../src/composables/useTerminalScrollSpeed");
    return { ...useTerminalScrollSpeed(), getTerminalScrollSpeed };
  };

  it("persists a set speed so the next load keeps it", async () => {
    const { setScrollSpeed, scrollSpeed } = await fresh();
    setScrollSpeed(0.5);
    expect(scrollSpeed.value).toBe(0.5);
    expect(localStorage.getItem(STORAGE_KEY)).toBe("0.5");
  });

  // The wheel handler runs outside any component and reads this plain getter per event, so it has
  // to see a change made in Settings — otherwise the alternate buffer keeps the old speed.
  it("exposes the current speed to the wheel handler's plain read", async () => {
    const { setScrollSpeed, getTerminalScrollSpeed } = await fresh();
    setScrollSpeed(0.25);
    expect(getTerminalScrollSpeed()).toBe(0.25);
  });

  it("steps by the given delta and stops at the bounds", async () => {
    const { nudgeScrollSpeed, scrollSpeed } = await fresh();
    nudgeScrollSpeed(-0.25);
    expect(scrollSpeed.value).toBe(TERMINAL_SCROLL_SPEED_DEFAULT - 0.25);
    nudgeScrollSpeed(-100);
    expect(scrollSpeed.value).toBe(TERMINAL_SCROLL_SPEED_MIN);
    nudgeScrollSpeed(100);
    expect(scrollSpeed.value).toBe(TERMINAL_SCROLL_SPEED_MAX);
  });

  // Repeated steps must stay on the grid the label prints: 0.25 increments in binary floats drift
  // (0.7500000000000001), and the stepper would then show a value it can't return to.
  it("keeps stepped values on the step grid", async () => {
    const { nudgeScrollSpeed, scrollSpeed } = await fresh();
    for (let i = 0; i < 3; i++) nudgeScrollSpeed(-0.25);
    expect(scrollSpeed.value).toBe(0.25);
    for (let i = 0; i < 3; i++) nudgeScrollSpeed(0.25);
    expect(scrollSpeed.value).toBe(1);
  });

  it("ignores a non-finite speed rather than storing it", async () => {
    const { setScrollSpeed, scrollSpeed } = await fresh();
    setScrollSpeed(NaN);
    expect(scrollSpeed.value).toBe(TERMINAL_SCROLL_SPEED_DEFAULT);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});
