// @vitest-environment node
// GET /api/session/:id carries the name the other Claude Code sessions message this one by (#3237),
// read off Claude Code's registry and matched through the tmux session MulmoTerminal named.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import { routeCall } from "../../helpers/routeCall";
import { mountSessionRoutes } from "../../../server/routes/session-routes";
import { forgetClaudePeers } from "../../../server/agents/claude/claude-peer-registry";
import { lastPrompts, lastResponses } from "../../../server/session/registry";

const SESSION = "6a0f3b1e-2c4d-4e8f-9a1b-0c2d3e4f5a6b";

const app = express();
mountSessionRoutes(app, { freshenRosterTitle: () => {}, publishActivity: () => {}, agentOfSession: () => null });
const call = routeCall(app);

let home = "";
let cwd = "";

async function writeRegistryEntry(over: Record<string, unknown>): Promise<void> {
  const dir = path.join(home, ".claude", "sessions");
  await fs.mkdir(dir, { recursive: true });
  const entry = { pid: process.pid, sessionId: "reissued-after-clear", cwd, name: "ws-7f", nameSource: "derived", updatedAt: 1, ...over };
  await fs.writeFile(path.join(dir, `${String(entry.pid)}.json`), JSON.stringify(entry));
}

const detail = (agent: string) => call(`/api/session/${SESSION}?${new URLSearchParams({ agent, cwd })}`);

beforeEach(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), "mt-session-detail-peer-"));
  vi.spyOn(os, "homedir").mockReturnValue(home);
  cwd = path.join(home, "ws");
  await fs.mkdir(cwd, { recursive: true });
  lastPrompts.delete(SESSION);
  lastResponses.delete(SESSION);
  forgetClaudePeers();
});

afterEach(async () => {
  vi.restoreAllMocks();
  forgetClaudePeers();
  await fs.rm(home, { recursive: true, force: true });
});

describe("GET /api/session/:id peerName", () => {
  it("names the claude running in the cell's tmux session", async () => {
    await writeRegistryEntry({ tmux: `mt-${SESSION}:@1.%1` });
    const res = await detail("claude");
    expect(res.status).toBe(200);
    expect(res.body.peerName).toBe("ws-7f");
  });

  it("is null when no running claude answers to the session, and for another agent", async () => {
    expect((await detail("claude")).body.peerName).toBeNull();
    await writeRegistryEntry({ tmux: `mt-${SESSION}:@1.%1` });
    forgetClaudePeers();
    expect((await detail("codex")).body.peerName).toBeNull();
  });
});
