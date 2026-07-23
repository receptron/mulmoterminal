import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.mock is hoisted above imports, so the doubles it returns must be created inside a
// vi.hoisted block rather than referencing top-level consts (which aren't initialized yet).
const { computeUpdateNotice, isUpdateCheckDisabled } = vi.hoisted(() => ({
  computeUpdateNotice: vi.fn<(pkgDir: string, version: string) => Promise<string | null>>(),
  isUpdateCheckDisabled: vi.fn<(env: Record<string, string | undefined>) => boolean>(),
}));
vi.mock("../../../bin/update-check.js", () => ({ computeUpdateNotice, isUpdateCheckDisabled }));

import { refreshUpdateStatus, getUpdateStatus } from "../../../server/config/update-status.js";

beforeEach(() => {
  computeUpdateNotice.mockReset();
  isUpdateCheckDisabled.mockReset();
});

describe("refreshUpdateStatus", () => {
  it("caches the computed notice for the route to serve", async () => {
    isUpdateCheckDisabled.mockReturnValue(false);
    computeUpdateNotice.mockResolvedValue("Update available: a1b2c3d → origin  ·  run: git pull");
    await refreshUpdateStatus();
    expect(getUpdateStatus()).toEqual({ notice: "Update available: a1b2c3d → origin  ·  run: git pull" });
  });

  it("caches null when the checkout is current", async () => {
    isUpdateCheckDisabled.mockReturnValue(false);
    computeUpdateNotice.mockResolvedValue(null);
    await refreshUpdateStatus();
    expect(getUpdateStatus()).toEqual({ notice: null });
  });

  // Opt-out must skip the probe entirely, not just hide the result.
  it("stays hidden and skips the check when opted out", async () => {
    isUpdateCheckDisabled.mockReturnValue(true);
    await refreshUpdateStatus();
    expect(getUpdateStatus()).toEqual({ notice: null });
    expect(computeUpdateNotice).not.toHaveBeenCalled();
  });

  // A thrown check must not surface — the badge just keeps its last value.
  it("does not throw when the check rejects", async () => {
    isUpdateCheckDisabled.mockReturnValue(false);
    computeUpdateNotice.mockRejectedValue(new Error("offline"));
    await expect(refreshUpdateStatus()).resolves.toBeUndefined();
  });
});
