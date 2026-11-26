// Starting a cell on a remote host (#3506), from the launch panel. Only the built-in agents and the
// shell are offered: a custom agent, an account and a launcher chip are entries in THIS machine's
// config, and the remote would resolve them against its own (or not at all).
import type { LaunchAgent } from "../../common/launchAgent";
import type { RemoteHostSummary } from "../../common/remoteHosts";

export interface RemoteStart {
  host: string;
  dir: string;
  agent: LaunchAgent;
}

export const canStartOn = (host: RemoteHostSummary): boolean => host.state === "reachable";

// Absolute only. The remote resolves a relative or empty `?cwd=` to its own default workspace, but
// an agent cell with no directory never starts (TerminalCell's autoStart guard needs one), and `~`
// is not expanded by the server, so either would be a cell that silently does something else.
export const remoteDirOf = (typed: string): string | null => {
  const dir = typed.trim();
  return dir.startsWith("/") ? dir : null;
};
