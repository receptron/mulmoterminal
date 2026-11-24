// The two PTYs that run a shell rather than an agent: the Run menu's one-off command
// (ephemeral, no session identity) and a configured launcher (persistent and reattachable,
// sharing the session lifecycle but with no hooks, transcript, or resume).
// Split from index.ts (#548 step 3c).
import type { IPty } from "node-pty";
import type { WebSocket } from "ws";
import { getLaunchers } from "../../config/config-routes.js";
import { launcherAt, launchInvocation, launchTargetLabel, shellInvocation, type LaunchTarget } from "./shell-command.js";
import { registerPty } from "../pty/pty-register.js";
import { ptySpawn, spawnPty } from "../pty/pty-spawn.js";
import { ptyExitLine, ptyStartLine } from "../pty/pty-exit-log.js";
import { wireAgentPtyRelay } from "../pty/pty-relay.js";
import { sendExitAndClose, sendFrame } from "../ws-frames.js";
import type { PtyEntry } from "../types.js";
import type { SpawnDeps } from "./spawn-deps.js";

export function createShellSpawners(deps: SpawnDeps) {
  // Run an arbitrary shell command in a PTY and relay its I/O to the browser. Unlike
  // spawnClaudePty this is NOT a Claude session — no id, no hooks, no transcript, no
  // reap/grace. It's an ephemeral grid terminal (the Run menu); the caller kills it
  // when the viewer's socket closes.
  function spawnCommandPty(command: string, cwd: string, ws: WebSocket): IPty {
    const { shell, args } = shellInvocation(command, false, process.platform, process.env.SHELL);
    const term = spawnPty(shell, args, cwd);
    const spawnedAtMs = Date.now();
    console.log(ptyStartLine({ agent: "command", pid: term.pid, cwd, tmux: false, reattached: false, note: command }));

    term.onData((data) => {
      sendFrame(ws, { type: "output", data });
    });
    term.onExit(({ exitCode, signal }) => {
      const lifetimeMs = Date.now() - spawnedAtMs;
      console.log(ptyExitLine({ agent: "command", exitCode, signal, lifetimeMs, cwd }));
      sendExitAndClose(ws, { exitCode, signal, lifetimeMs, reattached: false, ended: false, exitUnrecorded: false });
    });
    return term;
  }

  // Resolve a launcher by its position in the user's configured list — the browser
  // sends only an INDEX (the config is the allowlist), never a raw command.
  function resolveLauncher(index: number): { label: string; command: string } | null {
    return launcherAt(getLaunchers(), index);
  }

  // Spawn a configured launcher as a PERSISTENT, reattachable PTY that shares the Claude session
  // lifecycle (ptys map, reattach, reap grace) but has NO hooks, transcript, or resume.
  //
  // A launcher CHIP is a command line the user wrote, so it runs via the login shell with `exec`:
  // it becomes the single foreground process, its env vars expand, and it stays interactive. The
  // Shell cell's default is not that — it is a file this app picked, and on Windows it is handed
  // to the PTY directly with no shell in between (see LaunchTarget).
  function spawnLauncherPty(sessionId: string, ws: WebSocket, target: LaunchTarget, cwd: string): PtyEntry {
    // Persistent: reattaches a surviving tmux session (target ignored) or creates one.
    const { shell, args } = launchInvocation(target, process.platform, process.env.SHELL);
    const { term, tmux, reattached } = ptySpawn(sessionId, shell, args, cwd, true);
    const spawnedAtMs = Date.now();
    // The command is only what a FRESH session runs — an attach picked up whatever was already
    // there — so naming it on that line would describe a program nobody started.
    console.log(ptyStartLine({ agent: "launcher", pid: term.pid, cwd, tmux, reattached, sessionId, note: reattached ? null : launchTargetLabel(target) }));

    // Always "shell", whatever the command line names. A launcher is a command the user wrote and
    // this app does not read it: it once recorded `codex` for a command that started with the word
    // codex (#1208), which is a guess about someone else's text and the same guess that made a chip
    // indistinguishable from the Agent Picker. The Agent Picker is what records a real agent.
    const entry: PtyEntry = { term, ws, buffer: "", cwd, tmux, reattached, active: false, agent: "shell" };
    registerPty(sessionId, entry);
    // Persistent and tmux-backed like an agent cell, so its exit is read the same way (#1496).
    wireAgentPtyRelay(entry, sessionId, spawnedAtMs, deps, { loggedAs: "launcher" });
    return entry;
  }

  // A bot job's shell (backends/botJobs): the same persistent, reattachable pty a launcher is, but
  // started by the HOST with no browser asking — so no socket, and the grid is told a session was
  // created so it can adopt it (the caller marks it unplaced as "shell"). `file` and `args` are run
  // directly, never through a shell's parser: the job directory's path is not text anyone wrote.
  function spawnBotJobPty(sessionId: string, file: string, args: string[], cwd: string): PtyEntry {
    const { term, tmux, reattached } = ptySpawn(sessionId, file, args, cwd, true);
    const spawnedAtMs = Date.now();
    console.log(ptyStartLine({ agent: "bot-job", pid: term.pid, cwd, tmux, reattached, sessionId, note: null }));
    const entry: PtyEntry = { term, ws: null, buffer: "", cwd, tmux, reattached, active: false, agent: "shell" };
    registerPty(sessionId, entry);
    wireAgentPtyRelay(entry, sessionId, spawnedAtMs, deps, { loggedAs: "bot-job" });
    deps.publishSessionCreated(sessionId);
    return entry;
  }

  return { spawnCommandPty, spawnLauncherPty, spawnBotJobPty, resolveLauncher };
}
