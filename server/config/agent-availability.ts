// Which agent CLIs this machine has, answered once at boot (#2082).
//
// ONCE, like `AGENT_BINS` beside it and for the same stated reason: `<AGENT>_BIN` is a start-up
// setting, so changing it in the environment of a running server changes nothing, and asking per
// request would re-answer a question nobody changed.
//
// That freezing is also why the decision takes its inputs rather than reaching for them. `AGENT_BINS`
// captures every `<AGENT>_BIN` at import, so a caller — a spec above all — that sets one afterwards
// is talking to nobody: the values are already read. Passing the bins in is what makes the rule
// observable at all.
//
// `hasBinary` is the whole probe: it already resolves an absolute override, a bare name on PATH, and
// the "exists but is not executable" case that a naive `--version` spawn reports as simply missing.
import type { AgentAvailability } from "../../common/agentAvailability.js";
import { TERMINAL_AGENTS, type TerminalAgent } from "../../common/sessionAgent.js";
import { hasBinary } from "../infra/has-binary.js";
import { AGENT_BINS } from "./agent-bins.js";

export type AgentBins = Record<TerminalAgent, string>;

export const agentAvailability = (bins: AgentBins = AGENT_BINS, probe: (bin: string) => boolean = hasBinary): AgentAvailability[] =>
  TERMINAL_AGENTS.map((agent) => ({ agent, installed: probe(bins[agent]) }));

/** Resolved at import, so every reader shares one answer and no request pays for a filesystem walk
 *  per agent. */
export const AGENT_AVAILABILITY: readonly AgentAvailability[] = agentAvailability();
