import { describe, it, expect } from "vitest";
import { usePendingScript } from "../../../src/composables/usePendingScript";
import type { RunCommand } from "../components/runCommand";

const CMD: RunCommand = { source: "script", index: 1, label: "Build", cwd: "/proj" };

describe("usePendingScript", () => {
  it("hands the requested command to the next taker, then clears it", () => {
    const { requestRun, takePending } = usePendingScript();
    requestRun(CMD);
    expect(takePending()).toEqual(CMD);
    expect(takePending()).toBeNull(); // consumed — not delivered twice
  });

  it("returns null when nothing is pending", () => {
    const { takePending } = usePendingScript();
    expect(takePending()).toBeNull();
  });

  it("keeps only the latest request when called repeatedly", () => {
    const { requestRun, takePending } = usePendingScript();
    requestRun(CMD);
    requestRun({ ...CMD, label: "Test" });
    expect(takePending()?.label).toBe("Test");
  });
});
