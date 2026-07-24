// @vitest-environment node
import { describe, it, expect } from "vitest";
import path from "node:path";

import { resolveWatchDirs, shouldSchedule, isReloadableChange } from "../../scripts/dev-server-config.js";

describe("resolveWatchDirs", () => {
  const root = "/repo";

  it("watches server/, common/ and bin/ by default (not just server/)", () => {
    const dirs = resolveWatchDirs({}, root);
    // Codex #734: the backend imports common/modelIds.ts and bin/update-check.js, so editing
    // those must reload too — server/ alone regresses `node --watch`'s dependency tracking.
    expect(dirs).toEqual([path.join(root, "server"), path.join(root, "common"), path.join(root, "bin")]);
  });

  it("overrides to a single absolute dir when DEV_SERVER_WATCH is set", () => {
    expect(resolveWatchDirs({ DEV_SERVER_WATCH: "/srv/watch-me" }, root)).toEqual([path.resolve("/srv/watch-me")]);
  });
});

describe("shouldSchedule", () => {
  it("schedules a bring-up when idle", () => {
    expect(shouldSchedule({ shuttingDown: false, restartPending: false })).toBe(true);
  });

  it("skips when a restart is already pending — collapses an overlapping crash + file-change to one spawn", () => {
    // Codex #734: without this, a crash landing inside the file-change debounce would spawn a
    // second backend and race the first onto port 34567 (EADDRINUSE).
    expect(shouldSchedule({ shuttingDown: false, restartPending: true })).toBe(false);
  });

  it("skips while shutting down", () => {
    expect(shouldSchedule({ shuttingDown: true, restartPending: false })).toBe(false);
    expect(shouldSchedule({ shuttingDown: true, restartPending: true })).toBe(false);
  });
});

describe("isReloadableChange", () => {
  it("reloads on source extensions", () => {
    for (const f of ["index.ts", "a.mjs", "b.js", "c.json", "dir/deep.ts"]) expect(isReloadableChange(f)).toBe(true);
  });

  it("ignores editor temp files, extensionless names, and non-strings", () => {
    for (const f of ["index.ts.swp", "4913", "README.md", ".DS_Store"]) expect(isReloadableChange(f)).toBe(false);
    expect(isReloadableChange(null)).toBe(false);
    expect(isReloadableChange(undefined)).toBe(false);
  });
});
