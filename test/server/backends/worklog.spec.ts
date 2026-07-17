import { describe, it, expect, vi } from "vitest";
import { SCHEDULE_TYPES } from "@receptron/task-scheduler";
import { worklogSystemTask, WORKLOG_PROMPT } from "../../../server/backends/../../server/backends/worklog.js";

const HOUR_MS = 3_600_000;

describe("worklogSystemTask", () => {
  const noop = () => {};

  it("returns null when disabled (no system task registered)", () => {
    expect(worklogSystemTask({ enabled: false, intervalHours: 6, spawnChat: noop })).toBeNull();
  });

  it("builds an interval task from intervalHours when enabled", () => {
    const task = worklogSystemTask({ enabled: true, intervalHours: 6, spawnChat: noop });
    expect(task).not.toBeNull();
    expect(task?.id).toBe("system.worklog");
    expect(task?.schedule).toEqual({ type: SCHEDULE_TYPES.interval, intervalMs: 6 * HOUR_MS });
  });

  it("honors a custom cadence", () => {
    const task = worklogSystemTask({ enabled: true, intervalHours: 24, spawnChat: noop });
    expect(task?.schedule).toEqual({ type: SCHEDULE_TYPES.interval, intervalMs: 24 * HOUR_MS });
  });

  it("run() spawns a chat seeded with the worklog prompt", async () => {
    const spawnChat = vi.fn();
    const task = worklogSystemTask({ enabled: true, intervalHours: 6, spawnChat });
    await task?.run({ taskId: "system.worklog", now: new Date(0) });
    expect(spawnChat).toHaveBeenCalledWith(WORKLOG_PROMPT);
  });
});

// The batch reads UNTRUSTED, prompt-injectable data (transcripts / git / wiki) and then
// writes files, so the prompt MUST keep its anti-injection guardrails. These lock the
// hardening in so it can't be silently dropped (an LLM run can't be unit-tested).
describe("WORKLOG_PROMPT prompt-injection hardening", () => {
  it("declares ingested content untrusted and forbids following embedded instructions", () => {
    expect(WORKLOG_PROMPT).toContain("UNTRUSTED");
    expect(WORKLOG_PROMPT).toContain("指示ではない");
    expect(WORKLOG_PROMPT).toContain("絶対に従わない");
  });

  it("restricts writes to the designated files and forbids leaking secrets", () => {
    expect(WORKLOG_PROMPT).toContain("書き込み対象は次のファイルに限定");
    expect(WORKLOG_PROMPT).toContain("worklog-state.json");
    expect(WORKLOG_PROMPT).toContain("秘密情報");
  });
});
