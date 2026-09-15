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
//
// ASKED OF `ptyEnv()`, NOT `process.env`, which is what `diagnoseBinary`'s own docstring demands and
// what the spawn's preflight already does. `sanitizePtyEnv` strips the run-script PATH injections —
// `node_modules/.bin`, npm's node-gyp-bin, yarn's shim dir — so under `yarn dev` the two environments
// genuinely disagree. Measured: with a `muse` in `node_modules/.bin`, `process.env` answers true and
// the spawn's env answers false, so this route would have advertised an agent the cell then refuses
// with `SpawnBinaryError` (Codex review, round 4).
import type { AgentAvailability } from "../../common/agentAvailability.js";
import { TERMINAL_AGENTS, type TerminalAgent } from "../../common/sessionAgent.js";
import { hasBinary } from "../infra/has-binary.js";
import path from "node:path";
import { inheritedPtyEnv } from "../infra/pty-env.js";
import { AGENT_BINS } from "./agent-bins.js";

export type AgentBins = Record<TerminalAgent, string>;

const spawnEnvProbe = (bin: string): boolean => hasBinary(bin, inheritedPtyEnv(process.env, process.platform, path.delimiter));

export const agentAvailability = (bins: AgentBins = AGENT_BINS, probe: (bin: string) => boolean = spawnEnvProbe): AgentAvailability[] =>
  TERMINAL_AGENTS.map((agent) => ({ agent, installed: probe(bins[agent]) }));

/** Resolved at import, so every reader shares one answer and no request pays for a filesystem walk
 *  per agent. */
export const AGENT_AVAILABILITY: readonly AgentAvailability[] = agentAvailability();
