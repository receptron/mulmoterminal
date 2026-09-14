// @vitest-environment node
// The #1537 rule: a surviving tmux session is refused to a FOREIGN endpoint only on proof.
// `tmux new-session -A` attaches whatever runs in the pane while ignoring the argv, so after a
// server restart a stale persisted cell (asTerminalAgent reads any unrecognised value as
// "claude") could relabel a surviving codex as claude — and nothing on that path compared
// anything, because wrongEndpointReason needs a live PtyEntry to compare against.
import { describe, it, expect } from "vitest";
import { survivorAgents, foreignSurvivorReason, type SurvivorEvidence } from "../../../server/session/survivor-agent-guard.js";

const noEvidence: SurvivorEvidence = {
  claude: () => false,
  codex: () => false,
  antigravity: () => false,
  grok: () => false,
  muse: () => false,
  copilot: () => false,
  cursor: () => false,
};
const only = (agent: keyof SurvivorEvidence): SurvivorEvidence => ({ ...noEvidence, [agent]: () => true });

describe("survivorAgents", () => {
  it("names the one agent with evidence", () => {
    expect(survivorAgents("id", only("codex"))).toEqual(["codex"]);
    expect(survivorAgents("id", only("muse"))).toEqual(["muse"]);
  });

  it("stays silent with no evidence — the launcher/shell and pre-first-turn blind spot", () => {
    expect(survivorAgents("id", noEvidence)).toEqual([]);
  });

  it("reports contradictory evidence as-is, for the caller to treat as silence", () => {
    expect(survivorAgents("id", { ...only("claude"), codex: () => true })).toEqual(["claude", "codex"]);
  });
});

describe("foreignSurvivorReason", () => {
  it("serves a survivor to its own endpoint", () => {
    expect(foreignSurvivorReason("claude", ["claude"])).toBeNull();
    expect(foreignSurvivorReason("codex", ["codex"])).toBeNull();
    expect(foreignSurvivorReason("grok", ["grok"])).toBeNull();
  });

  // The #1537 case: a coerced persisted cell reconnects a codex survivor through /ws.
  it("refuses a provably foreign survivor", () => {
    expect(foreignSurvivorReason("claude", ["codex"])).toContain("belongs to codex, not claude");
    expect(foreignSurvivorReason("codex", ["claude"])).toContain("belongs to claude, not codex");
    expect(foreignSurvivorReason("antigravity", ["muse"])).toContain("belongs to muse, not antigravity");
  });

  // A chip's survivors are shells and command lines, which leave no evidence — so evidence
  // under a chip's key can only mean the key names an agent's session.
  it("refuses an agent's own key opened as a launcher chip", () => {
    expect(foreignSurvivorReason("launch", ["claude"])).toContain("belongs to claude, not launch");
  });

  // Refuse-on-proof, attach-on-silence: shutting users out of a legitimately surviving shell
  // (or an agent session that never reached its first turn) would be worse than the mislabel.
  it("attaches when there is no evidence", () => {
    expect(foreignSurvivorReason("claude", [])).toBeNull();
    expect(foreignSurvivorReason("launch", [])).toBeNull();
  });

  it("attaches on contradictory evidence rather than picking a side", () => {
    expect(foreignSurvivorReason("claude", ["claude", "codex"])).toBeNull();
    expect(foreignSurvivorReason("grok", ["claude", "codex"])).toBeNull();
  });

  it("has no opinion for the run endpoint, which owns no sessions", () => {
    expect(foreignSurvivorReason("run", ["claude"])).toBeNull();
  });
});
