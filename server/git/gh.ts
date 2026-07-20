// Shared `gh` CLI runner for the cross-repo PR / issue views. The GitHub CLI's own
// login is the auth; args are passed as argv only (no shell). Callers get a per-repo
// result and decide how to surface errors, so one failing repo never sinks the view.
import { spawnCollect } from "./spawn-collect.js";

export interface GhResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

export function runGh(args: string[]): Promise<GhResult> {
  return spawnCollect("gh", args, { errorStderr: "gh not found (install the GitHub CLI and run `gh auth login`)" });
}
