// @vitest-environment node
//
// Which agent a session runs, for one that outlived this process (#3272). An agent's pane now runs
// the exit recorder's `sh`, so its running command says "shell"; the session's own environment names
// the agent instead, and must win. What it cannot vouch for falls back to the pane, as before.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fakePtyEntry } from "../../../helpers/fakePtyEntry";

const recorded = vi.fn<(id: string) => string | null>(() => null);
const paneCommand = vi.fn<(id: string) => string | null>(() => null);
vi.mock("../../../../server/infra/process/tmux.js", () => ({
  tmuxSessionAgent: (id: string) => recorded(id),
  tmuxPaneCommand: (id: string) => paneCommand(id),
}));

const { agentOfSession } = await import("../../../../server/session/list/session-lookup.js");
const { ptys } = await import("../../../../server/session/registry.js");

const ID = "11111111-2222-4333-8444-555555555555";

beforeEach(() => {
  ptys.clear();
  recorded.mockReset().mockReturnValue(null);
  paneCommand.mockReset().mockReturnValue(null);
});

describe("agentOfSession", () => {
  it("takes a live pty's own word over anything tmux says", () => {
    ptys.set(ID, fakePtyEntry({ agent: "codex" }));
    recorded.mockReturnValue("claude");
    paneCommand.mockReturnValue("claude");
    expect(agentOfSession(ID)).toBe("codex");
  });

  // The recorder's shell is the pane's running command; read alone it would make every survivor a shell.
  it.each(["claude", "codex", "cursor", "muse"])("names a recorded %s even though its pane runs sh", (agent) => {
    recorded.mockReturnValue(agent);
    paneCommand.mockReturnValue("sh");
    expect(agentOfSession(ID)).toBe(agent);
  });

  // A session from before the record existed, a shell, or a value it cannot vouch for: the pane decides.
  it.each([null, "", "shell", "bash", "not-an-agent", "Claude"])("falls back to the pane when the record is %j", (value) => {
    recorded.mockReturnValue(value);
    paneCommand.mockReturnValue("claude");
    expect(agentOfSession(ID)).toBe("claude");
  });

  it("is null when nothing can say", () => {
    expect(agentOfSession(ID)).toBeNull();
  });
});
