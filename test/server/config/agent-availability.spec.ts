// @vitest-environment node
//
// What GET /api/agents answers (#2082): one row per launchable agent, `installed` decided by the
// same binary resolution the spawn will use.
//
// The bins are PASSED IN rather than set through the environment, and that is not a convenience:
// `AGENT_BINS` captures every `<AGENT>_BIN` at import, so a spec that sets one afterwards is
// talking to nobody — the values are already read. That freezing is the shipped behaviour
// (`<AGENT>_BIN` is a start-up setting), so the decision is what gets tested, with the reading
// supplied.
import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { TERMINAL_AGENTS } from "../../../common/sessionAgent";
import { agentAvailability, type AgentBins } from "../../../server/config/agent-availability";

const binsWhere = (overrides: Partial<AgentBins> = {}): AgentBins => {
  const bins = Object.fromEntries(TERMINAL_AGENTS.map((agent) => [agent, `/nowhere/${agent}`]));
  return { ...bins, ...overrides } as AgentBins;
};

const installedOf = (agent: string, bins: AgentBins, probe?: (bin: string) => boolean) =>
  agentAvailability(bins, probe).find((entry) => entry.agent === agent)?.installed;

describe("agentAvailability", () => {
  it("answers one row per launchable agent, in the type's own order", () => {
    expect(agentAvailability(binsWhere(), () => false).map((entry) => entry.agent)).toEqual([...TERMINAL_AGENTS]);
  });

  it("reports an agent whose binary is nowhere as not installed", () => {
    expect(agentAvailability(binsWhere(), () => false).every((entry) => !entry.installed)).toBe(true);
  });

  it("asks the probe about the resolved bin, which is what the spawn will run", () => {
    const asked: string[] = [];
    agentAvailability(binsWhere({ codex: "/opt/bin/codex" }), (bin) => {
      asked.push(bin);
      return bin === "/opt/bin/codex";
    });
    expect(asked).toContain("/opt/bin/codex");
  });

  it("reports only the agents the probe recognises", () => {
    const bins = binsWhere({ codex: "/opt/bin/codex" });
    expect(installedOf("codex", bins, (bin) => bin === "/opt/bin/codex")).toBe(true);
    expect(installedOf("claude", bins, (bin) => bin === "/opt/bin/codex")).toBe(false);
  });
});

// The default probe is `hasBinary`, and these pin the two answers that decide whether a user is
// told "install it" or nothing at all.
describe("the real probe", () => {
  it("counts an executable file and not a file that merely exists", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "mt-agents-"));
    try {
      const runnable = path.join(dir, "codex");
      const notRunnable = path.join(dir, "claude");
      [runnable, notRunnable].forEach((bin) => writeFileSync(bin, "#!/bin/sh\nexit 0\n"));
      chmodSync(runnable, 0o755);
      // A file that is there but cannot be run is not an installed agent, and saying so is the
      // difference between "install it" and "chmod +x it".
      chmodSync(notRunnable, 0o644);
      const bins = binsWhere({ codex: runnable, claude: notRunnable });
      expect(installedOf("codex", bins)).toBe(true);
      expect(installedOf("claude", bins)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
