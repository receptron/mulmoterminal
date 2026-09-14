// The hook file every cursor session on this machine reads, plus the small poster it runs.
//
// Three measurements against cursor-agent 2026.09.10-fd3934a shape everything here, and each one
// fails SILENTLY when you get it wrong — there is no error, no warning, and a cell that runs
// perfectly while reporting nothing.
//
// 1. ONE BAD ENTRY VOIDS THE WHOLE FILE. A probe arming sixteen event names fired NOTHING; one of
//    the sixteen was not a real event name. Remove it and the other fifteen fire. The same is true
//    of a rejected COMMAND (below): a single unacceptable entry takes every other event with it.
//    That is why CURSOR_HOOK_EVENTS is derived from the translation map rather than written out,
//    and why the guard in `hooksCommandFor` refuses to write at all rather than write a file that
//    would void itself.
//
// 2. A COMMAND CONTAINING A URL IS REFUSED. `curl … http://127.0.0.1:<port>/api/hook` never ran —
//    nor did `env curl …`, nor `node poster.js <event> http://…`. The same poster with the URL
//    baked in and only the PORT on the command line runs every time. `touch <path>` runs; the
//    common factor in every failure is a URL in the command string. Hence the poster script, and
//    hence the port travelling as a bare integer argument.
//
// 3. THE TUI AND PRINT MODE FIRE DIFFERENT EVENTS. In `-p` print mode `beforeSubmitPrompt`,
//    `afterAgentResponse` and `stop` never fire; in the interactive TUI all three do. A cell runs
//    the TUI, which is the only reason this agent has status at all — the upstream bug report that
//    says the CLI omits those three is describing print mode and does not separate the two.
//
// WHERE THE FILE MAY LIVE. Measured in the TUI: `~/.cursor/hooks.json` fires,
// `<workspace>/.cursor/hooks.json` fires, and `--plugin-dir` does NOT (it works in print mode
// only). The per-spawn flag would have been the clean answer — claude gets exactly that with
// `--settings` — and it is not available. The project file is not used either: it lands inside the
// user's own repository, where it shows up in `git status` and can be committed by accident. So the
// file is MACHINE-GLOBAL, as copilot's is, and carries copilot's consequences:
//
//   - Cursor sessions this server never started also post here — the user's own, in a plain
//     terminal, or another instance's. (Only while a live MulmoTerminal holds the port the file
//     names: the poster checks the instance registry first, so a file left by a crashed server
//     posts nowhere at all.) They carry a chat id we do not host, and THE ROUTE DOES NOT
//     DROP THEM: `resolveHookSessionId` checks the id's shape, not its ownership, so the activity
//     flags and a finished-turn push are applied for an id with no pty. (`noteWorkPhase` is the one
//     effect already gated on a live entry, and its comment in hook-routes.ts says why — "any
//     well-formed uuid may be posted here".) This comment used to claim the caller dropped them,
//     which was simply false; CodeRabbit caught it where nine Codex rounds did not.
//
//     Gating the rest is a real change and deliberately not this one: the obvious gate,
//     `ptys.has(id)`, drops hooks for a session that SURVIVED a restart and has not reconnected
//     yet, which is the case the survivor machinery exists to preserve. A correct gate needs a
//     "this server has ever known this id" predicate that spans restarts, and it changes copilot's
//     shipped behaviour identically — so it is revertable on its own, which is the test for
//     whether it belonged here.
//   - Two MulmoTerminal instances on different ports share this file and the last writer wins; the
//     other instance's cursor cells then run without status until their next spawn rewrites it.
//     An ACCEPTED LIMITATION, logged rather than silent, exactly as for copilot.
//
// WHAT THIS CODE CLAIMS. Copilot's file is `hooks/mulmoterminal.json` inside a directory copilot
// SCANS, so naming it is a namespace claim. Cursor reads ONE fixed path, so there is no namespace
// to claim: a user who keeps their own hooks there (GitButler writes one) collides with us by
// construction. We therefore REFUSE rather than merge. Merging our entries into their arrays and
// un-merging on exit would re-introduce the exact tear copilot-hooks-file.ts was rewritten to
// remove — a crash between the two writes leaves their file carrying our commands, pointed at a
// dead port. The cost of refusing is status for that user, and it is in the log.
//
// OWNERSHIP IS A PROPERTY OF THE FILE'S CONTENTS, as it is for copilot and for the same reason: a
// marker beside the file is a PAIR, and whichever half is written first, a crash between them
// leaves the pair disagreeing. Our file says it is ours — every command it registers runs the
// poster whose name nothing else writes.
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { liveInstances } from "../../bin/instances.js";
import { isRecord } from "../../common/isRecord.js";
import { readString } from "../../common/readString.js";
import os from "node:os";
import path from "node:path";
import { CURSOR_HOOK_EVENTS } from "./cursor-hook.js";
import { mulmoterminalHome } from "../infra/mulmoterminal-home.js";
import { messageOf } from "../errors.js";

/** Cursor's config directory. Taken as a parameter everywhere below so a spec can point at a temp
 *  directory; there is no documented environment override to honour, unlike copilot's
 *  `COPILOT_HOME`. */
export const cursorHome = (): string => path.join(os.homedir(), ".cursor");

/** The one path cursor reads. Not ours to name — see the header on what that costs. */
export const cursorHooksFile = (home: string = cursorHome()): string => path.join(home, "hooks.json");

/** The poster, in OUR directory rather than cursor's. It holds the URL, which the command line
 *  cannot (measurement 2), and it is not an ownership question: nothing but our own hooks file
 *  references it, so an orphaned copy does nothing at all. */
const POSTER_NAME = "cursor-hook.mjs";
export const cursorPosterScript = (home: string = mulmoterminalHome()): string => path.join(home, POSTER_NAME);

/** What makes a hooks file OURS: every entry runs THIS poster, at its absolute path, with a
 *  registered event name and a numeric port after it.
 *
 *  The first version of this asked only whether the command CONTAINED "cursor-hook.mjs", and Codex
 *  reproduced what that costs: a user's own
 *  `{"stop":[{"command":"/usr/local/bin/my-cursor-hook.mjs stop"}]}` was read as ours and
 *  OVERWRITTEN — the one thing this file's whole design says must never happen, and it matters here
 *  more than for copilot because cursor's path is the user's single fixed `~/.cursor/hooks.json`
 *  rather than a name we chose inside a directory copilot scans.
 *
 *  The node path — token 0 — is deliberately NOT checked. It is `process.execPath` at the time of
 *  writing, and a node upgrade would otherwise make our own file unrecognisable to us: refused by
 *  the sync, never replaced, posting to a dead port forever. That is the "file we can never
 *  replace" hazard #2063 spent two rounds removing, and it is not worth re-creating to reject a
 *  command that already had to name our own directory. */
function isOurCommand(command: string, script: string): boolean {
  const [, path_, event, port, ...rest] = command.split(" ");
  return rest.length === 0 && path_ === script && CURSOR_HOOK_EVENTS.includes(event ?? "") && /^\d+$/.test(port ?? "");
}

// What THIS process last published, BY FILE. The only unforgeable evidence available: a file on
// disk can be made to look like ours by anyone who can write the user's home, but nothing can make
// it match a string we are holding in memory and never wrote down. It is what licenses the one
// destructive act here — the unlink on exit. Keyed by path because one process can address two
// homes (every function takes `home`, and the specs use a fresh temp dir per case).
const publishedByThisProcess = new Map<string, string>();

/** Write through a temp file and rename. `writeFileSync` truncates first, so a crash mid-write
 *  leaves malformed JSON — which every check here reads as "not ours", so nothing would replace it
 *  and it would sit there posting to a dead port. A rename is atomic on the platforms this ships
 *  to, so the file at that path is always a whole one. */
function writeAtomically(file: string, contents: string): void {
  const tmp = `${file}.tmp-${process.pid}`;
  try {
    writeFileSync(tmp, contents, "utf8");
    renameSync(tmp, file);
  } catch (err) {
    rmSync(tmp, { force: true });
    throw err;
  }
}

// Small on purpose. A hook is a synchronous step in someone's turn.
const HOOK_TIMEOUT_MS = 5000;

/** The poster's source. Written on every sync, so a build that changes it needs no migration.
 *
 *  It writes `{}` on stdout because a hook that answers with nothing is treated as a hook that
 *  declined to decide; `{}` is the "no opinion" answer, and anything else here would start
 *  influencing the user's session rather than observing it. */
/** The poster's imports and the two constants that cannot travel on the command line. */
function posterPreamble(instancesDir: string): string {
  return `// Generated by MulmoTerminal. Posts one cursor hook payload to a local MulmoTerminal.
// The URL and the instance registry's path live HERE and not on the command line: cursor silently
// refuses to run a hook command whose command line contains a URL, and one refused entry voids the
// whole hooks file.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";

const INSTANCES = ${JSON.stringify(instancesDir)};
const [event, port] = process.argv.slice(2);
`;
}

/** IS ANYONE THERE? A hook file outlives the server that wrote it — a crash skips the exit handler,
 *  and a user who edits the file makes it one MulmoTerminal may no longer rewrite or remove. A
 *  stranded command must therefore be HARMLESS rather than merely unlucky: without this it posts
 *  every prompt and tool argument to a bare local port. */
function posterLivenessCheck(): string {
  return `
function servedByLiveMulmoTerminal() {
  let entries;
  try {
    entries = fs.readdirSync(INSTANCES);
  } catch {
    // Fails OPEN: a machine where the registry was never writable keeps the status it has today.
    return true;
  }
  return entries.some((name) => {
    try {
      const entry = JSON.parse(fs.readFileSync(path.join(INSTANCES, name), "utf8"));
      if (String(entry.port) !== String(port)) return false;
      process.kill(entry.pid, 0); // throws unless that process exists
      return true;
    } catch {
      return false;
    }
  });
}
`;
}

/** …AND IS IT REALLY US? The registry cannot answer that alone: a crashed instance's entry can name
 *  a pid the OS has since recycled, so "alive" and "ours" are different questions. Asked of the
 *  port itself, and asked BEFORE the payload is sent, because the payload is the user's prompt and
 *  their tool arguments.
 *
 *  `agent: false` on both requests: node keeps sockets alive by default, and a kept-alive socket
 *  holds this short-lived process open until the idle timeout fires — five seconds, on every hook,
 *  which is the opposite of what that timeout is for. Caught by RUNNING the poster, not reading it. */
function posterIdentifyThenPost(): string {
  return `
function identifyThenPost(body) {
  const probe = http.request({ host: "127.0.0.1", port: Number(port), path: "/api/hook", method: "GET", agent: false }, (res) => {
    let answer = "";
    res.setEncoding("utf8");
    res.on("data", (chunk) => (answer += chunk));
    res.on("end", () => {
      try {
        if (JSON.parse(answer).mulmoterminal !== true) return;
      } catch {
        return; // something is listening and it is not us
      }
      const req = http.request(
        {
          host: "127.0.0.1",
          port: Number(port),
          path: "/api/hook",
          method: "POST",
          headers: { "content-type": "application/json", "x-mt-agent": "cursor", "x-mt-hook": event },
          agent: false,
        },
        (res2) => res2.resume(),
      );
      req.setTimeout(${HOOK_TIMEOUT_MS}, () => req.destroy());
      req.on("error", () => {});
      req.end(body);
    });
  });
  probe.setTimeout(${HOOK_TIMEOUT_MS}, () => probe.destroy());
  probe.on("error", () => {});
  probe.end();
}

// \`{}\` is cursor's "no opinion" answer, and it is written whether or not the post happens.
process.stdout.write("{}");
if (!servedByLiveMulmoTerminal()) process.exit(0);

let body = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => (body += chunk));
process.stdin.on("end", () => identifyThenPost(body));
`;
}

/** The whole poster, assembled from the three pieces above. */
export function cursorPosterSource(instancesDir: string = path.join(mulmoterminalHome(), "instances")): string {
  return posterPreamble(instancesDir) + posterLivenessCheck() + posterIdentifyThenPost();
}

interface HookEntry {
  command: string;
}

/** One event's command, or null when this machine cannot be given one that would survive.
 *
 *  The space check is not fussiness. Cursor splits the command into arguments itself and this file
 *  has no verified quoting, so a node path or a home directory containing a space would produce an
 *  entry cursor cannot run — and by measurement 1 that does not lose one event, it loses the FILE.
 *  Refusing to write, loudly, is the only outcome here that a reader can act on. Windows is where
 *  this bites (`C:\\Program Files\\nodejs`), and Windows is untested for this agent. */
function hooksCommandFor(event: string, port: string | number, script: string): string | null {
  if (/\s/.test(process.execPath) || /\s/.test(script)) return null;
  return `${process.execPath} ${script} ${event} ${port}`;
}

/** The file's whole contents, or null when no command could be built. Pure, so a spec can pin the
 *  shape without a filesystem. */
export function cursorHooksJson(port: string | number, script: string = cursorPosterScript()): string | null {
  const hooks: Record<string, HookEntry[]> = {};
  for (const event of CURSOR_HOOK_EVENTS) {
    const command = hooksCommandFor(event, port, script);
    if (!command) return null;
    hooks[event] = [{ command }];
  }
  return JSON.stringify({ version: 1, hooks }, null, 2) + "\n";
}

/** Every command in the file, for the two questions asked of its contents. */
function commandsOf(file: string): string[] | null {
  try {
    const raw: unknown = JSON.parse(readFileSync(file, "utf8"));
    if (!isRecord(raw) || !isRecord(raw.hooks)) return null;
    const commands: string[] = [];
    for (const list of Object.values(raw.hooks)) {
      if (!Array.isArray(list) || list.length === 0) return null;
      for (const entry of list) {
        const command = isRecord(entry) ? readString(entry.command) : undefined;
        if (!command) return null;
        commands.push(command);
      }
    }
    return commands.length > 0 ? commands : null;
  } catch {
    return null; // absent, unreadable, or not JSON — nothing of ours to protect
  }
}

/** Is the file on disk OURS? Asked of its own contents: every entry, and at least one.
 *  `[].every()` is vacuously true, so an empty list must not read as ours. */
function isOursOnDisk(home: string = cursorHome(), mtHome: string = mulmoterminalHome()): boolean {
  const commands = commandsOf(cursorHooksFile(home));
  const script = cursorPosterScript(mtHome);
  return commands !== null && commands.every((command) => isOurCommand(command, script));
}

/** The port a file of OURS is posting to, or null. The port is the last token of every command; a
 *  file whose commands disagree is not one we wrote. Read rather than substring-matched, because a
 *  bare `includes("3000")` also matches port 30000. */
function portInFile(home: string, mtHome: string = mulmoterminalHome()): string | null {
  const commands = commandsOf(cursorHooksFile(home));
  // Only OURS has a port worth reading. Without this the startup repair reads a number out of a
  // stranger's command line and then decides what to do about "our" file on the strength of it.
  if (!commands || !commands.every((command) => isOurCommand(command, cursorPosterScript(mtHome)))) return null;
  const ports = new Set(commands.map((command) => command.split(" ").at(-1)));
  const only = ports.size === 1 ? [...ports][0] : undefined;
  return only ?? null;
}

/**
 * Write the poster and the hook file, unless they already say exactly this.
 *
 * The no-op case is the common one — every boot, and every spawn, asks — and rewriting a file the
 * agent may be reading at that moment buys nothing. Failure is logged and swallowed: a home
 * directory we cannot write is a cursor session without status, which is worse than claude's but
 * far better than a spawn that refuses to start.
 */
export function syncCursorHooksFile(port: string | number, home: string = cursorHome(), mtHome: string = mulmoterminalHome()): void {
  const file = cursorHooksFile(home);
  const script = cursorPosterScript(mtHome);
  const next = cursorHooksJson(port, script);
  if (next === null) {
    console.warn(
      `[cursor] a path with a space (node: ${process.execPath}) cannot be written into a cursor hook command — cursor sessions will run without status`,
    );
    return;
  }
  try {
    const existing = existsSync(file) ? readFileSync(file, "utf8") : null;
    // Someone else's file at the one path cursor reads — including one that REPLACED ours while we
    // were not running. Refused rather than merged: a hook file is a list of commands run inside
    // the user's agent, and rewriting one we did not write is the kind of "helpful" edit that
    // should never be automatic.
    if (existing !== null && existing !== next && !isOursOnDisk(home, mtHome)) {
      console.warn(`[cursor] ${file} exists and was not written by MulmoTerminal — leaving it alone; cursor sessions will run without status`);
      return;
    }
    // The poster is written even when the hook file already matches: the bytes on disk may be a
    // previous build's, and nothing else would ever replace them.
    mkdirSync(path.dirname(script), { recursive: true });
    writeAtomically(script, cursorPosterSource(path.join(mtHome, "instances")));
    if (existing === next) {
      // A restart on the SAME port, most often after a crash. Record the bytes so the exit handler
      // will remove a file this process is now responsible for; without this it would decline, and
      // the file would outlive us again.
      publishedByThisProcess.set(path.resolve(file), next);
      return;
    }
    // A file of ours naming a DIFFERENT port is the other instance's. Said out loud, because the
    // loser's symptom — cells that run perfectly and report nothing — is otherwise unattributable.
    const previous = existing === null ? null : portInFile(home, mtHome);
    if (previous !== null && previous !== String(port)) {
      console.warn(
        `[cursor] taking over ${file} from another MulmoTerminal instance on port ${previous} — ITS cursor cells will stop reporting status until it spawns again`,
      );
    }
    mkdirSync(path.dirname(file), { recursive: true });
    writeAtomically(file, next);
    publishedByThisProcess.set(path.resolve(file), next);
    console.log(`[cursor] hooks registered in ${file}`);
  } catch (err) {
    console.warn(`[cursor] could not write ${file} — sessions will run without status (${messageOf(err)})`);
  }
}

/**
 * Drop our hook file when this server exits.
 *
 * NOT tidiness, though it is no longer the ONLY thing standing between a leftover and a stranger:
 * since round 16 of #2065 the poster itself refuses to post unless the instance registry names a
 * LIVE MulmoTerminal on that port, so a stranded command is harmless rather than merely unlucky.
 * Removing the file is still right — it stops a pointless process spawn on every one of that
 * user's turns, and it is the only way OUR entries leave a file we may no longer rewrite.
 *
 * The poster script is deliberately LEFT: it is in our own directory, it references nothing, and
 * removing it would race a sibling instance that is still using it.
 *
 * `process.on("exit")` does not run on SIGKILL or a hard crash, so a file CAN outlive a server that
 * died badly. The next spawn of any instance rewrites it with a live port, which is the ordinary
 * repair; the window is a machine where MulmoTerminal crashed and is never started again.
 */
export function removeCursorHooksFile(home: string = cursorHome()): void {
  const file = cursorHooksFile(home);
  // Licensed by memory rather than by anything on disk: the bytes must be exactly what THIS process
  // published. A signature in the file cannot carry that weight — a user can write our poster's
  // name into a file of their own — and a peer that took the file over has changed those bytes, so
  // this also covers an exiting instance that would otherwise delete a live one's file.
  const published = publishedByThisProcess.get(path.resolve(file));
  if (published === undefined) return;
  try {
    if (readFileSync(file, "utf8") !== published) return; // read immediately before removing
    rmSync(file, { force: true });
  } catch {
    // Exiting anyway. A file we could not remove is repaired by the next spawn's rewrite.
  }
}

/** Is this port held by a MulmoTerminal that is running right now?
 *
 *  The registry is the ONLY authority, with no fallback — `liveInstances()` answers `[]` both for
 *  "no instance is running" and for "the registry could not be read", and treating the first as the
 *  second would let a dead port's file be protected forever. Answering "no" when the registry is
 *  unreadable is the safe direction, because the caller's response to "no" is a WRITE, not a
 *  delete — and what that write refuses is a file that is not OURS. A live peer's file IS ours, so
 *  on a machine whose registry was never writable this takes that peer's file over at startup: the
 *  accepted two-instance limitation reached by another route, undone by its next spawn.
 *
 *  Keyed on the PORT rather than on a pid, which is what the marker gave copilot: the file itself
 *  names the port, so there is no second artifact to keep in step and no pid to be reused. */
function servedByLiveInstance(port: string): boolean {
  try {
    return liveInstances(-1).some((peer: { port: number | null }) => String(peer.port) === port); // exclude nothing
  } catch {
    return false;
  }
}

/**
 * At startup: REPAIR a hook file whose owner is gone. It never creates one and never deletes one.
 *
 * The exit handler above covers an ordinary shutdown. It does not run on SIGKILL or a hard crash,
 * and without this the leftover would be repaired only when someone next spawned a cursor cell — so
 * a machine that crashed and then used cursor OUTSIDE MulmoTerminal would keep posting prompts at a
 * port nobody here holds.
 */
export function repairStaleCursorHooksFile(port: string | number, home: string = cursorHome(), mtHome: string = mulmoterminalHome()): void {
  // Nothing to repair, and nothing to create: a machine that has never run a cursor cell should not
  // acquire a hook file just because a server started.
  if (!existsSync(cursorHooksFile(home))) return;
  const previous = portInFile(home, mtHome);
  // Not ours at all: syncCursorHooksFile would refuse it anyway, and saying so here would say it
  // twice on every boot.
  if (previous === null) return;
  // A LIVE PEER's file is left to it: taking it over at startup would stand its cells down for no
  // reason, and the ordinary takeover happens at spawn, where there is a session to serve.
  //
  // OUR OWN PORT is NOT in that exemption, and that is the fix for a leak rather than a nicety. A
  // file naming this port is a crashed predecessor's — nobody else can be bound to it — and
  // returning here left it un-ADOPTED: `publishedByThisProcess` stayed empty, so this server's own
  // clean shutdown declined to remove it and it outlived us pointing at a port nobody serves. The
  // sync below adopts an identical file and rewrites a differing one, which is what the exit
  // handler needs to have happened (Codex round 13 of #2065; copilot answered the same question in
  // round 4 of #2063).
  //
  // The peer check is therefore asked only of a DIFFERENT port, which also keeps our own registry
  // entry — written at boot, naming this very port — from matching and defeating the adoption.
  if (previous !== String(port) && servedByLiveInstance(previous)) return;
  // A WRITE, not an unlink — proving ownership of a file written by a process that no longer exists
  // cannot be done from disk alone, and syncCursorHooksFile refuses anything that is not ours.
  syncCursorHooksFile(port, home, mtHome);
}
