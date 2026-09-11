// Try the platform's file-manager / launcher commands in turn until one STARTS.
//
// Shared by the two routes that hand a path to the OS — `/api/files/open` (the application that
// owns the file, #2038) and `/api/files/reveal` (its folder, with it selected, #2039). Only the
// argv differs between them, and that is the argument: the candidate list, the WSL translation,
// the "answer once something started" rule and the 500 that names every attempt are the same
// reasoning in both, and two copies of it drift one fix at a time.
import { spawn } from "node:child_process";
import { openDirCommands } from "./open-dir.js";
import { isWsl, toWindowsPath } from "./wsl.js";

/** Injected so a spec can assert the argv without a window appearing on the machine. */
export type Spawner = typeof spawn;

/** The argv for one opener, given the target in the form THAT opener wants (a Windows spelling
 *  under WSL). Called after the translation so a command that builds one token out of the path —
 *  `explorer /select,<path>` — receives the spelling it will actually use. */
export type ArgvFor = (cmd: string, target: string) => string[];

// Resolves null once the child is RUNNING, or the reason it could not start. The exit code is
// deliberately not awaited: `explorer.exe` returns 1 on a perfectly successful open, and the user
// is done with us the moment the window appears.
function startOnce(cmd: string, args: string[], spawner: Spawner): Promise<string | null> {
  return new Promise((resolve) => {
    const child = spawner(cmd, args, { detached: true, stdio: "ignore" });
    child.on("error", (e) => resolve(e.message));
    child.on("spawn", () => {
      child.unref();
      resolve(null);
    });
  });
}

/** Null once an opener has started, or a sentence naming every attempt. Callers answer `{ok:true}`
 *  on null and 500 on the sentence — never ok first: saying so and logging the failure to a console
 *  nobody reads is what made a host with no opener report a launch that never happened (#1447). */
export async function spawnFirstOpener(target: string, argvFor: ArgvFor, spawner: Spawner): Promise<string | null> {
  const attempts: string[] = [];
  for (const candidate of openDirCommands(process.platform, isWsl(process.platform, process.env))) {
    const asked = candidate.windowsPath ? await toWindowsPath(target) : target;
    if (asked === null) {
      attempts.push(`${candidate.cmd}: wslpath could not translate ${target}`);
      continue;
    }
    const failure = await startOnce(candidate.cmd, argvFor(candidate.cmd, asked), spawner);
    if (failure === null) return null;
    attempts.push(`${candidate.cmd}: ${failure}`);
  }
  return attempts.join("; ");
}
