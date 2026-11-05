// @vitest-environment node
import { describe, it, expect } from "vitest";
import path from "node:path";
import { rolloutDayDirs } from "../../../../server/agents/codex/codex-rollout-days.js";

const root = path.join("r", "sessions");
const dir = (y: string, m: string, d: string): string => path.join(root, y, m, d);
const at = (y: number, monthIndex: number, d: number, h = 12): Date => new Date(y, monthIndex, d, h);

describe("rolloutDayDirs", () => {
  it("covers today and yesterday for a watcher started now", () => {
    const now = at(2026, 10, 6);
    expect(rolloutDayDirs(root, now)).toEqual([dir("2026", "11", "06"), dir("2026", "11", "05")]);
  });
  it("names no folder twice when the start was yesterday", () => {
    expect(rolloutDayDirs(root, at(2026, 10, 6), at(2026, 10, 5))).toEqual([dir("2026", "11", "06"), dir("2026", "11", "05")]);
  });
  it("adds the start day once the watcher has outlived yesterday", () => {
    expect(rolloutDayDirs(root, at(2026, 10, 9), at(2026, 10, 6))).toEqual([dir("2026", "11", "09"), dir("2026", "11", "08"), dir("2026", "11", "06")]);
  });
  it("crosses a month and a year", () => {
    expect(rolloutDayDirs(root, at(2027, 0, 1), at(2026, 11, 29))).toEqual([dir("2027", "01", "01"), dir("2026", "12", "31"), dir("2026", "12", "29")]);
  });
  it("keeps the start day when the start was earlier the same day", () => {
    expect(rolloutDayDirs(root, at(2026, 10, 6, 23), at(2026, 10, 6, 0))).toEqual([dir("2026", "11", "06"), dir("2026", "11", "05")]);
  });
});
