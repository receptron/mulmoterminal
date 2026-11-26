// Whether a remote host can be used, from what its /api/update-status answered. Pure.
//
// The terminal frames and the API shapes are the remote's own, and only the major version promises
// them; a different major is refused so the cell can say why, instead of failing on a frame it cannot read.
import { parseUpdateStatus } from "../../../common/updateStatus.js";
import type { RemoteHostState } from "../../../common/remoteHosts.js";

const majorOf = (version: string): string => version.split(".")[0] ?? version;

export function remoteHostState(localVersion: string, statusBody: unknown): { state: RemoteHostState; version: string | null } {
  const status = parseUpdateStatus(statusBody);
  if (!status) return { state: "unreachable", version: null };
  const state = majorOf(status.version) === majorOf(localVersion) ? "reachable" : "version-mismatch";
  return { state, version: status.version };
}
