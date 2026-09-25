// @vitest-environment node
import { describe, it, expect } from "vitest";
import { latestOnly } from "../../../../src/components/blueprints/latestOnly";

describe("latestOnly", () => {
  it("keeps only the newest ticket current", () => {
    const reads = latestOnly();
    const poll = reads.take();
    const action = reads.take();
    expect(reads.isLatest(poll)).toBe(false);
    expect(reads.isLatest(action)).toBe(true);
  });

  it("outdates a response that arrives after a newer request was sent, whatever order they return in", async () => {
    const reads = latestOnly();
    const shown: string[] = [];
    const request = async (label: string, delay_ms: number): Promise<void> => {
      const ticket = reads.take();
      await new Promise((resolve) => setTimeout(resolve, delay_ms));
      if (reads.isLatest(ticket)) shown.push(label);
    };
    await Promise.all([request("stale poll", 30), request("action", 5)]);
    expect(shown).toEqual(["action"]);
  });
});
