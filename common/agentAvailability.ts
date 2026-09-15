// Which agent CLIs this machine actually has, and which one the launch form should therefore offer
// first (#2082).
//
// In `common/` because both sides decide from it: the server answers it from the filesystem, and the
// UI picks the form's initial agent from the answer.
//
// THE WORD "DEFAULT" MEANS TWO DIFFERENT THINGS HERE, and only one of them may move.
//
//   - The WIRE default is `claude`, permanently. `asTerminalAgent` reads anything unrecognised as
//     claude, `storedCellAgent` omits the field when it is claude, and `agent ?? "claude"` appears
//     across the UI and the remote-host protocol. That is not a preference — it is what a grid cell
//     persisted before the field existed MEANS, so changing it would rewrite data already on disk.
//   - The initial PICK is what this file decides: what the form offers before the user has said
//     anything. Offering an agent that cannot run is the defect; a Codex-only machine should not be
//     shown Claude and a cell that dies on spawn.
import { isRecord } from "./isRecord.js";
import { TERMINAL_AGENTS, type TerminalAgent } from "./sessionAgent.js";

export interface AgentAvailability {
  agent: TerminalAgent;
  /** The agent's binary — `<AGENT>_BIN` or its default name — resolved and executable. */
  installed: boolean;
}

/** The body of GET /api/agents. */
export interface AgentAvailabilityList {
  agents: AgentAvailability[];
}

const isAvailability = (value: unknown): value is AgentAvailability =>
  isRecord(value) && typeof value.installed === "boolean" && TERMINAL_AGENTS.some((agent) => agent === value.agent);

/** The response, read back. A body that is not the shape answers an empty list rather than throwing:
 *  a host too old to serve this route says nothing about what is installed, and "nothing known" must
 *  leave the existing default alone rather than move it. */
export function parseAgentAvailability(body: unknown): AgentAvailability[] {
  if (!isRecord(body)) return [];
  const agents: unknown = body.agents;
  return Array.isArray(agents) ? agents.filter(isAvailability) : [];
}

/** Whether `agent` is known to be missing. Unknown is NOT missing — an agent the list says nothing
 *  about (an older host, a failed fetch) must not be treated as absent, or the form would walk away
 *  from a perfectly good choice on no evidence. */
export const knownMissing = (agent: TerminalAgent, availability: readonly AgentAvailability[]): boolean =>
  availability.some((entry) => entry.agent === agent && !entry.installed);

/** The agent the launch form should offer, given what is installed.
 *
 *  Claude when it is there, because it is the default everywhere else and a machine that has it
 *  should behave exactly as it does today. Otherwise the first installed agent in TERMINAL_AGENTS
 *  order — an arbitrary but STABLE rule, so two machines with the same CLIs agree and a user does
 *  not get a different answer on each boot.
 *
 *  `current` is returned unchanged whenever it is not known to be missing, which is what keeps this
 *  from overriding a deliberate choice. */
export function offerableAgent(current: TerminalAgent, availability: readonly AgentAvailability[]): TerminalAgent {
  if (!knownMissing(current, availability)) return current;
  const installed = TERMINAL_AGENTS.find((agent) => availability.some((entry) => entry.agent === agent && entry.installed));
  return installed ?? current;
}
