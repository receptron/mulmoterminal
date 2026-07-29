// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createAntigravitySpawner } from "../../../server/session/spawn-antigravity.js";
import { ptys } from "../../../server/session/registry.js";
import type { SpawnDeps } from "../../../server/session/spawn-deps.js";

vi.mock("../../../server/session/pty-spawn.js", () => ({
  ptySpawn: vi.fn(() => ({
    term: {
      pid: 1234,
      onData: vi.fn(),
      onExit: vi.fn(),
    },
    tmux: false,
  })),
}));

describe("createAntigravitySpawner", () => {
  const dummyDeps = {
    antigravityBin: "agy",
    antigravityModel: null,
    outputBufferLimit: 10000,
    reap: vi.fn(),
  } as unknown as SpawnDeps;

  beforeEach(() => {
    ptys.clear();
  });

  it("spawns an antigravity PTY entry and registers it in ptys registry", () => {
    const { spawnAntigravityPty } = createAntigravitySpawner(dummyDeps);
    const entry = spawnAntigravityPty("session-1", null, null, "/test/dir");

    expect(entry.agent).toBe("antigravity");
    expect(entry.cwd).toBe("/test/dir");
    expect(ptys.get("session-1")).toBe(entry);
  });
});
