// The two PTYs that run a shell rather than an agent: the Run menu's one-off command
// (ephemeral, no session identity) and a configured launcher (persistent and reattachable,
// sharing the session lifecycle but with no hooks, transcript, or resume).
// Split from index.ts (#548 step 3c).
import type { IPty } from "node-pty";
import type { WebSocket } from "ws";
import { getLaunchers } from "../config/config-routes.js";
import { launcherAt, shellInvocation } from "./shell-command.js";
import { ptys } from "./registry.js";
import { ptySpawn, spawnPty } from "./pty-spawn.js";
import { sendExitAndClose, sendFrame } from "./ws-frames.js";
import { appendBoundedOutput } from "./terminal-replay.js";
import type { PtyEntry } from "./types.js";
import type { SpawnDeps } from "./spawn-deps.js";

export function createShellSpawners(deps: SpawnDeps) {
  // Run an arbitrary shell command in a PTY and relay its I/O to the browser. Unlike
  // spawnClaudePty this is NOT a Claude session — no id, no hooks, no transcript, no
  // reap/grace. It's an ephemeral grid terminal (the Run menu); the caller kills it
  // when the viewer's socket closes.
  function spawnCommandPty(command: string, cwd: string, ws: WebSocket): IPty {
    const { shell, args } = shellInvocation(command, false, process.platform, process.env.SHELL);
    const term = spawnPty(shell, args, cwd);
    console.log(`[pty] spawned command (pid=${term.pid}) in ${cwd}: ${command}`);

    term.onData((data) => {
      sendFrame(ws, { type: "output", data });
    });
    term.onExit(({ exitCode, signal }) => {
      console.log(`[pty] command exited code=${exitCode} signal=${signal}`);
      sendExitAndClose(ws, exitCode, signal);
    });
    return term;
  }

  // Resolve a launcher by its position in the user's configured list — the browser
  // sends only an INDEX (the config is the allowlist), never a raw command.
  function resolveLauncher(index: number): { label: string; command: string } | null {
    return launcherAt(getLaunchers(), index);
  }

  // Spawn a configured launcher command as a PERSISTENT, reattachable PTY that shares
  // the Claude session lifecycle (ptys map, reattach, reap grace) but has NO hooks,
  // transcript, or resume. The command is run via the login shell with `exec` so it
  // becomes the single foreground process ($SHELL, codex, etc.) — env vars in the
  // command (e.g. $SHELL) expand, and the process stays interactive in the PTY.
  function spawnLauncherPty(sessionId: string, ws: WebSocket, command: string, cwd: string): PtyEntry {
    // Persistent: reattaches a surviving tmux session (command ignored) or creates one.
    const { shell, args } = shellInvocation(command, true, process.platform, process.env.SHELL);
    const { term, tmux } = ptySpawn(sessionId, shell, args, cwd, true);
    console.log(`[pty] spawned launcher (pid=${term.pid}${tmux ? " via tmux" : ""}) in ${cwd}: ${command}`);

    const entry: PtyEntry = { term, ws, buffer: "", cwd, tmux, active: false, agent: "shell" };
    ptys.set(sessionId, entry);

    term.onData((data) => {
      entry.buffer = appendBoundedOutput(entry.buffer, data, deps.outputBufferLimit);
      sendFrame(entry.ws, { type: "output", data });
    });
    term.onExit(({ exitCode, signal }) => {
      console.log(`[pty] launcher exited code=${exitCode} signal=${signal}`);
      sendExitAndClose(entry.ws, exitCode, signal);
      deps.reap(sessionId);
    });
    return entry;
  }

  return { spawnCommandPty, spawnLauncherPty, resolveLauncher };
}
