// @vitest-environment node
// The walk from a session to the rollout its processes hold open (#3283), with the three listings
// injected: which pids are asked about, and that a listing nobody could take attributes nothing.
import { describe, it, expect, vi } from "vitest";
import { findOpenCodexRollout, type OpenRolloutProbe } from "../../../../../server/session/spawn/agents/codex-open-rollout-recovery.js";

const SID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeee01";
const ROOT = "/home/.codex/sessions";
const ROLLOUT = `${ROOT}/2026/11/05/rollout-2026-11-05T22-40-08-01a1ad94-4239-70c3-aff1-e7bf4f66d5b5.jsonl`;

// pane 100 -> shell 101 -> codex 102; an unrelated process 200 under pid 1.
const ROWS = [
  { pid: 101, ppid: 100, cpuSeconds: 0 },
  { pid: 102, ppid: 101, cpuSeconds: 0 },
  { pid: 200, ppid: 1, cpuSeconds: 0 },
];

const probeWith = (overrides: Partial<OpenRolloutProbe> = {}): OpenRolloutProbe => ({
  listPanePids: async () => new Map([[SID, [100]]]),
  listProcesses: async () => ROWS,
  openFiles: async () => ["/dev/ttys004", ROLLOUT],
  canonical: (dir) => dir,
  ...overrides,
});

describe("findOpenCodexRollout", () => {
  it("asks lsof about the pane and everything under it, and nothing else", async () => {
    const openFiles = vi.fn<OpenRolloutProbe["openFiles"]>(async () => [ROLLOUT]);
    expect(await findOpenCodexRollout(SID, ROOT, new Set(), probeWith({ openFiles }))).toBe(ROLLOUT);
    expect([...(openFiles.mock.calls[0]?.[0] ?? [])].sort()).toEqual([100, 101, 102]);
  });

  it("covers every pane of a split session", async () => {
    const openFiles = vi.fn<OpenRolloutProbe["openFiles"]>(async () => [ROLLOUT]);
    await findOpenCodexRollout(SID, ROOT, new Set(), probeWith({ listPanePids: async () => new Map([[SID, [100, 200]]]), openFiles }));
    expect([...(openFiles.mock.calls[0]?.[0] ?? [])].sort()).toEqual([100, 101, 102, 200]);
  });

  it("returns nothing for a session tmux does not list", async () => {
    const openFiles = vi.fn<OpenRolloutProbe["openFiles"]>(async () => [ROLLOUT]);
    expect(await findOpenCodexRollout(SID, ROOT, new Set(), probeWith({ listPanePids: async () => new Map(), openFiles }))).toBeNull();
    expect(openFiles).not.toHaveBeenCalled();
  });

  it.each([
    ["tmux", { listPanePids: async () => null }],
    ["ps", { listProcesses: async () => null }],
    ["lsof", { openFiles: async () => null }],
  ] satisfies [string, Partial<OpenRolloutProbe>][])("returns nothing when %s cannot answer", async (_name, override) => {
    expect(await findOpenCodexRollout(SID, ROOT, new Set(), probeWith(override))).toBeNull();
  });

  it("refuses a rollout another cell claimed", async () => {
    expect(await findOpenCodexRollout(SID, ROOT, new Set([ROLLOUT]), probeWith())).toBeNull();
  });

  it("compares against the resolved root lsof prints", async () => {
    const probe = probeWith({ canonical: () => "/private/home/.codex/sessions", openFiles: async () => [ROLLOUT.replace("/home", "/private/home")] });
    expect(await findOpenCodexRollout(SID, ROOT, new Set(), probe)).toBe(ROLLOUT);
  });
});
