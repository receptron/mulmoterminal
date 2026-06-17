// Builds the `docker run` argv that wraps a `claude` invocation in the
// mulmoterminal-sandbox image. The result is passed to node-pty as
// `pty.spawn("docker", args, …)`, so `-i -t` allocates a real TTY inside
// the container (Claude's Ink UI needs one) and node-pty bridges it to
// the browser terminal — resize propagates via SIGWINCH like any other
// interactive `docker run`.
//
// Key design choices:
//   - Workspace is mounted at its IDENTICAL host path and selected with
//     `-w`, so claude's project-session directory encoding
//     (~/.claude/projects/<encoded-cwd>) matches the host's. Combined
//     with mounting host ~/.claude into the container, the sidebar and
//     resume keep working with no path translation.
//   - The GUI MCP server and the activity hooks run on the HOST; the
//     container reaches them via host.docker.internal (see index.ts).
//   - `--user uid:gid` runs the whole container as the host user with
//     zero added capabilities. SSH/gh credential forwarding (mulmoclaude's
//     entrypoint machinery) is intentionally deferred.
import { homedir } from "os";
import { join } from "path";
import { IMAGE_NAME } from "./docker.js";

// Host env vars forwarded into the container when present. claude can
// authenticate via the mounted ~/.claude(.json) OAuth token OR an API
// key; we pass the common keys through so either path works.
const FORWARDED_ENV_KEYS = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL", "GEMINI_API_KEY", "GOOGLE_API_KEY"];

export interface SandboxArgsParams {
  /** Absolute host workspace path (CLAUDE_CWD). Mounted at the same path. */
  workspacePath: string;
  /** The `claude …` argv (everything after the binary name). */
  claudeArgs: string[];
  uid: number;
  gid: number;
  platform?: NodeJS.Platform;
  home?: string;
  env?: NodeJS.ProcessEnv;
}

export function buildSandboxDockerArgs(params: SandboxArgsParams): string[] {
  const { workspacePath, claudeArgs, uid, gid, platform = process.platform, home = homedir(), env = process.env } = params;
  const toDockerPath = (p: string): string => p.replace(/\\/g, "/");

  const claudeDir = join(home, ".claude");
  const claudeJson = join(home, ".claude.json");

  // On Linux host.docker.internal isn't built in — map it to the gateway.
  const extraHosts = platform === "linux" ? ["--add-host", "host.docker.internal:host-gateway"] : [];

  const envArgs: string[] = [];
  for (const key of FORWARDED_ENV_KEYS) {
    const value = env[key];
    if (value) envArgs.push("-e", `${key}=${value}`);
  }

  return [
    "run",
    "--rm",
    // -i keeps stdin open; -t allocates a container TTY for Claude's Ink UI.
    "-i",
    "-t",
    "--user",
    `${uid}:${gid}`,
    "-e",
    "HOME=/home/node",
    ...envArgs,
    // Credentials + session store: mount the host's ~/.claude so sessions
    // written inside the container land in the same place the host server
    // reads them from.
    "-v",
    `${toDockerPath(claudeDir)}:/home/node/.claude`,
    "-v",
    `${toDockerPath(claudeJson)}:/home/node/.claude.json`,
    // Workspace at its identical absolute path (see file header).
    "-v",
    `${toDockerPath(workspacePath)}:${toDockerPath(workspacePath)}`,
    "-w",
    toDockerPath(workspacePath),
    ...extraHosts,
    IMAGE_NAME,
    "claude",
    ...claudeArgs,
  ];
}
