// What the launcher decides before it starts anything, kept out of the executable so each
// decision can be checked without a process to exit or a terminal to type into.
//
// `--cwd` picks the workspace claude runs in and whose sessions the sidebar lists, so it is
// a data-scope boundary: getting it wrong points the whole app at someone else's project.
// `--port` decides whether a clash is a hard error or a silent retry. Both used to be
// decided inside the executable, where they exit the process on a bad value and so could not
// be checked at all (#611 A3).
//
// These return a decision; the caller prints and exits. Nothing here reads argv, the
// environment or the filesystem.
import { isIP } from "node:net";
import { join } from "node:path";

// The v4 loopback every local client of this server dials by literal — `guiMcpUrlTemplate` in
// server/infra/gui-mcp-registration.ts builds `http://127.0.0.1:<port>/api/mcp/...`. Duplicated
// here because bin/ is plain JS and cannot import the server's TypeScript, and pinned by a spec
// the same way PORT_IN_USE_EXIT_CODE is.
const V4_LOOPBACK_CLIENTS_DIAL = "127.0.0.1";

// What a kernel reports for a v6 wildcard bind. Exact, not a spelling: this is what
// `server.address()` RETURNS, and it returns nothing else for an unspecified v6 bind.
const V6_UNSPECIFIED = "::";

/** A port a user typed, in either of the two places they can type one. `parseInt` stops at the
 *  first non-digit, so a typo would otherwise launch on a port nobody named — "80x" silently
 *  becoming 80 is worse than being told. `source` names the place, so the message points at
 *  what to correct. */
function readPort(raw, source) {
  const parsed = Number.parseInt(raw ?? "", 10);
  if (!Number.isInteger(parsed) || String(parsed) !== raw || parsed < 1 || parsed > 65535) {
    return { error: `Invalid ${source} value: "${raw ?? ""}" (expected integer 1..65535)` };
  }
  return { port: parsed, explicit: true };
}

/**
 * Which port the launcher should ask for: `--port` > `PORT` > the default — the order
 * `bin/room.js` already uses, so the two entry points of this package agree.
 *
 * `PORT` was ignored entirely until #1861, while the busy-port message told people to set it.
 * An invalid one is refused rather than dropped for the same reason a bad `--port` is: falling
 * back to the default silently IS the bug being fixed. An empty or unset `PORT` is not a value
 * and falls through.
 *
 * A `PORT` from the environment counts as `explicit`, which is what decides whether a busy port
 * stops the launch or offers a second instance on another one. The user named a port either
 * way, and offering a different one answers a question nobody asked.
 */
export function parsePortArg(args, env, defaultPort) {
  const at = args.indexOf("--port");
  if (at !== -1) return readPort(args[at + 1], "--port");
  if (env.PORT === undefined || env.PORT === "") return { port: defaultPort, explicit: false };
  return readPort(env.PORT, "PORT");
}

/**
 * The address the server will bind, and therefore the ONE address a port probe has to try.
 *
 * `isPortFree` used to probe with no host — the `::` dual-stack wildcard — and its comment
 * justified that by saying the server did the same. It did, until the server moved to loopback
 * by default (b696a967, 2026-07-26) and never touched this file. From then on the probe asked
 * about an address nothing was listening on, so it answered "free" for a port a running
 * MulmoTerminal was holding, and the second-instance guard (#611, #653) stopped firing (#1876).
 *
 * Measured on macOS: a bind only collides with the SAME address. With 34567 held on
 * `127.0.0.1`, `listen(34567)`, `listen(34567,'::')` and `listen(34567,'0.0.0.0')` all
 * succeed; only `listen(34567,'127.0.0.1')` reports EADDRINUSE.
 *
 * So this is deliberately NOT a fixed host. Pinning `127.0.0.1` would re-break what #31 fixed —
 * an operator who widens the bind would go back to missing a peer on the wildcard. The probe
 * follows whatever the server will do, by reading the same variable the server reads
 * (`BIND_HOST` in server/config/env.ts). Keep the default in step with that file; a spec
 * asserts the two agree, the same way PORT_IN_USE_EXIT_CODE is pinned.
 *
 * And note what the probe is FOR: not "is anyone using this port", but "will the child's
 * listen(port, BIND_HOST) succeed". Probing the same address answers exactly that.
 */
export function bindHostFor(env) {
  return env.MULMOTERMINAL_HOST || "127.0.0.1";
}

/**
 * A port probe failed. Does that mean the PORT IS TAKEN, or only that the probe could not ask?
 *
 * Only `EADDRINUSE` answers the question. Naming a host on the probe (see bindHostFor) made the
 * other errors reachable for the first time: a `MULMOTERMINAL_HOST` that is not an address on
 * this machine fails `EADDRNOTAVAIL`, a name that does not resolve fails `ENOTFOUND`, and a
 * privileged port fails `EACCES`. Folding any of those into "in use" tells the operator to stop
 * a process that does not exist and to pick a port that was never the problem.
 *
 * The honest answer for those is "I could not tell", and the useful behaviour is to let the
 * launch proceed: the server binds for real and reports the actual errno, which is exactly what
 * happened before the probe named a host.
 */
export function probeFailureIsPortInUse(err) {
  return Boolean(err) && err.code === "EADDRINUSE";
}

/**
 * Given the address the OS says a bind actually LANDED ON, which other addresses must also be
 * free before this launch is worth starting.
 *
 * `127.0.0.1` ALWAYS, whatever the bind — and getting there took four rounds of me arguing the
 * opposite. The claim I kept making was that a specific non-loopback bind is chosen to serve
 * OTHER machines, so a degraded local listener costs only convenience and the server's warning
 * covers it. That mischaracterises what such a bind is: MulmoTerminal still runs its PTYs on THIS
 * machine whatever address it listens on, and those sessions' GUI MCP dials `http://127.0.0.1:
 * <port>` as a literal (`guiMcpUrlTemplate`). A LAN bind changes who can open the browser, not
 * where the sessions live. So the purpose does not survive after all, and the server's own
 * failure text says as much: "hooks and the GUI MCP will fail until it is free".
 *
 * `::1` as well for the v6 wildcard, because that is the address the launcher will poll and print
 * for it, and a specific `::1` socket is MORE SPECIFIC than a dual-stack bind — it would win the
 * connection.
 *
 * It takes the bound address and not the requested string, and that is the other half of the
 * point. Rounds went to spellings — `::` vs `0:0:0:0:0:0:0:0`, `::1` vs its long form,
 * `localhost`, `127.1` — and a host string has no last case. The kernel has none of that problem:
 * measured, `listen(0,"0:0:0:0:0:0:0:0")` reports `::` and `listen(0,"localhost")` reports `::1`.
 * The comparisons below are exact because the kernel's OUTPUT vocabulary is finite even though
 * its input vocabulary is not. server/infra/loopback.ts made the same argument for its own
 * question: "asking after the fact answers all of them".
 *
 * The probe/bind race the launcher already lives with is unchanged: this narrows the window, it
 * does not close it.
 */
export function companionHostsFor(boundAddress) {
  const required = boundAddress === V6_UNSPECIFIED ? ["::1", V4_LOOPBACK_CLIENTS_DIAL] : [V4_LOOPBACK_CLIENTS_DIAL];
  return required.filter((host) => host !== boundAddress);
}

/**
 * The concrete address the LAUNCHER should connect to, or **null when it cannot know**.
 *
 * This is the PERMITTED set, not a list of bad cases, and it got there the hard way: four review
 * rounds each found a different spelling of `BIND_HOST` that a guess got wrong — the poll
 * ignoring it, the URL turning `::1` back into `localhost`, `localhost` passing through
 * unresolved, and then the fallback re-opening that same hole. A host string has no last case
 * (`127.1`, `127.000.000.001`, a hosts file pointing `localhost` somewhere else), so the rule
 * is inverted: an address the platform itself calls an IP is usable, the two wildcards map to
 * the loopback of their own family, and **everything else is null** — reported rather than
 * guessed at.
 *
 * `::` maps to `::1` and not to `127.0.0.1` on purpose: a v4 socket on 127.0.0.1 is MORE
 * SPECIFIC than a dual-stack bind and wins the connection, so polling v4 could be answered by
 * the very stranger this exists to avoid.
 *
 * The authority for a name is the kernel, not this function, and the launcher asks it the only
 * way that is exact — the child reports what `server.address()` says it bound. See
 * server/infra/loopback.ts, which had already written the argument down for its own question.
 */
export function launcherReachHost(bindHost) {
  if (bindHost === "0.0.0.0") return "127.0.0.1";
  if (bindHost === "::") return "::1";
  return isIP(bindHost) ? bindHost : null;
}

/** What to name a concrete address with — never `localhost`, because this one exists to say
 *  WHICH ADDRESS WAS CHECKED. `launcherReachHost` picks `::1` precisely so an IPv4 listener
 *  cannot answer for us, and writing `localhost` would hand that choice straight back: measured,
 *  `localhost` resolves to BOTH `::1` and `127.0.0.1`.
 *
 *  This is no longer what the BROWSER is sent to — see `browserUrl`, and #1889 for why those are
 *  two different questions.
 *
 *  Built through `URL` so the platform does the escaping: an IPv6 literal has to be bracketed or
 *  `http://::1:34567` is not a URL at all. The brackets go on BEFORE the assignment because the
 *  `hostname` setter silently REJECTS an unbracketed v6 literal — measured: it leaves the
 *  previous host in place, so the launcher would have printed the base host instead. */
export function launcherUrl(reachHost, port) {
  const url = new URL(`http://localhost:${port}`);
  url.hostname = reachHost.includes(":") ? `[${reachHost}]` : reachHost;
  return url.origin;
}

/**
 * The URL the BROWSER is opened at — always `localhost`, and that is a COMPATIBILITY constraint,
 * not a preference about which spelling reads better.
 *
 * The grid layout (`grid_v2`), the theme, the font size and eleven other things live in
 * `localStorage`, which is partitioned by ORIGIN. So this string is not merely an address the
 * user is sent to; it is the key their state is filed under. Changing it silently empties the
 * app: 4.11.0 moved it to `http://127.0.0.1:<port>` as part of #1876's review and every upgrading
 * user's grid came up blank, with their sessions alive in tmux and nothing on screen to say the
 * layout was one hostname away (#1889).
 *
 * And there is no way back for state left on the old origin. Measured on Chrome 152: a hidden
 * iframe on the old origin reads an EMPTY store (third-party storage partitioning), and
 * `document.requestStorageAccess()` resolving does not change that — it governs cookies. Only a
 * TOP-LEVEL visit to the old origin can see it. A URL that has to be stable is therefore cheaper
 * to keep stable than to migrate.
 *
 * SECOND, INDEPENDENT reason, and the one this comment was missing: Firebase gates
 * `signInWithPopup` on the CALLING PAGE'S ORIGIN, against the authorized-domain list of the
 * project — and RemoteHost's Google sign-in is exactly that call
 * (`src/components/RemoteHostControl.vue`, against `mulmoserver` in `common/firebaseConfig.ts`).
 * Reported on #1900: that project authorizes `localhost` and NOT `127.0.0.1`, checked in the
 * console on 2026-08-28, which is why phone pairing could not sign in on 4.11.0 and can on
 * 4.12.0. Not verified here — this repo cannot read that project's settings.
 *
 * It matters because the two reasons fail INDEPENDENTLY. Someone who solves the storage half —
 * moves the grid layout server-side, say — would read the paragraph above as the whole
 * justification and be free to change this string, and the first thing to break would be a
 * feature nothing in `bin/` mentions. Changing the URL means adding the new loopback address to
 * that authorized-domain list first.
 *
 * Reachability is not the reason it is safe; #1834 is. `server/infra/loopback-listener.ts` makes
 * this server serve `127.0.0.1` in EVERY configuration — as the primary bind, or as a second
 * listener when the operator widens it — because eight local callers write that address as a
 * literal. So `localhost` arrives here whatever `MULMOTERMINAL_HOST` says, falling back to v4
 * when v6 refuses.
 *
 * What this deliberately does NOT do is decide anything about the port PROBE or the readiness
 * POLL. Those still follow the address the child reports binding, which is what #1876 actually
 * fixed — the second-instance guard, and a ready banner that was reporting a stranger's 200. The
 * residual risk restored here is only the one 4.10.1 and every release before it carried: another
 * APP holding this port on `::1` alone could answer a browser resolving `localhost` that way. A
 * second MulmoTerminal cannot, because `companionHostsFor` requires `127.0.0.1` free for every
 * bind before the child is ever spawned.
 */
export function browserUrl(port) {
  return new URL(`http://localhost:${port}`).origin;
}

/**
 * Where to send the browser, and what to say about it — as one decision, because the two answers
 * have to agree.
 *
 * `localhostIsUnambiguous` is a MEASUREMENT, not a guess: the launcher tried to bind `[::1]:port`
 * before spawning, so `false` means something else already answers there. That is the hole Codex
 * flagged on this change and it is real for the DEFAULT bind, not only a widened one —
 * `companionHostsFor` requires `127.0.0.1` free for every launch but never asks about `::1`, and
 * `localhost` resolves to BOTH (measured). Sending the browser to `localhost` while a stranger
 * holds the v6 loopback is exactly the case #1876's review was worried about.
 *
 * So the rule is: use the name the user's state is filed under WHEN NOTHING ELSE CAN ANSWER TO
 * IT, and otherwise say plainly that we stepped aside — including where their layout went, since
 * a silent switch here is #1889 all over again for that one user.
 *
 * Stepping aside costs more than the layout, and the note says so: on `http://127.0.0.1:<port>`
 * RemoteHost's Google sign-in is refused as well, because Firebase checks the page's origin
 * against its authorized domains and that project lists `localhost` only (#1900). This branch is
 * a real degradation of the app rather than a cosmetic change of address, and the second failure
 * would otherwise be found only by trying to pair a phone — which is the shape of #1889 again,
 * one feature further along.
 *
 * The probe cannot close the window, only narrow it: `::1` is free when asked, and unless the
 * server binds it (a `::1` or `::` bind), a stranger could still take it afterwards. That is the
 * same probe/bind race `isPortFree` already documents and accepts.
 *
 * The loopback spellings below are compared against the address the kernel REPORTED, whose output
 * vocabulary is finite — not against anything a user typed.
 */
export function launchTarget(reachHost, port, localhostIsUnambiguous) {
  if (!localhostIsUnambiguous) {
    const checked = launcherUrl(reachHost, port);
    return {
      url: checked,
      note: `Something else is already listening on [::1]:${port}, so the browser is being sent to ${checked} — the address that was checked. If your layout and settings look empty, they are filed under http://localhost:${port}, and the phone's Google sign-in works only there.`,
    };
  }
  const bound = reachHost === V4_LOOPBACK_CLIENTS_DIAL || reachHost === "::1";
  return {
    url: browserUrl(port),
    // `browserUrl` sends everyone to `localhost`, which is right for the machine the launcher runs
    // on and useless to the operator who set `MULMOTERMINAL_HOST` so ANOTHER machine could open
    // the app. 4.11.0 told them their address by putting it in the banner; saying it here means
    // restoring the origin costs them nothing.
    note: bound ? null : `Bound to ${reachHost} — reachable from another machine at ${launcherUrl(reachHost, port)}`,
  };
}

/**
 * Which directory to run in, before it is made absolute.
 * Precedence: `--cwd` (relative allowed) > CLAUDE_CWD > the directory the launcher was run
 * from. `mustExist` is set only for `--cwd`: a typo there should stop the launch, while a
 * CLAUDE_CWD naming a directory that isn't there yet is the managed-workspace case the
 * server creates on boot.
 */
export function chooseCwd(args, env) {
  const at = args.indexOf("--cwd");
  if (at === -1) return { path: env.CLAUDE_CWD ?? ".", mustExist: false };
  const value = args[at + 1];
  // A missing value swallows the next flag ("--cwd --port 3000" would run in a directory
  // called "--port"), so anything flag-shaped is treated as absent.
  if (value === undefined || value.startsWith("-")) return { error: "--cwd requires a directory path" };
  return { path: value, mustExist: true };
}

/**
 * What to say when the port is taken.
 *
 * Running a second server is not a supported setup: both share ~/.mulmoterminal and the
 * workspace, but each keeps its own PTYs, pub/sub and in-memory caches, so the two disagree
 * about state neither can see the other change. Starting one silently on another port —
 * which is what a plain second `npx mulmoterminal` used to do — is how someone ends up in
 * that setup without knowing (#611).
 *
 * So the message has to answer the two things the user actually wants: where the running one
 * is, and how to insist if a second is really wanted.
 */
export function portInUseMessage(port, explicit) {
  const lines = [`Port ${port} is already in use.`];
  lines.push(`  If that is MulmoTerminal, it is already running at http://localhost:${port}`);
  lines.push(explicit ? "  Pick a different --port, or stop the other process." : "  To start a second one anyway: --port <number>");
  return lines.join("\n");
}

/**
 * What to do when the wanted port is taken: "ask" whether to start a second instance,
 * or "stop".
 *
 * Two conditions rule the question out. A port the user NAMED — `--port`, or `PORT` in the
 * environment (#1861) — already says which one was wanted, so offering a different one answers
 * a question nobody asked; and with no terminal to type into (a script, a service, CI) a prompt
 * has nobody to answer it and would hang the start instead of failing it.
 */
export function portInUseAction(explicit, isTTY) {
  return explicit || !isTTY ? "stop" : "ask";
}

/**
 * The question asked when the default port is taken and there is somebody to answer.
 *
 * Two servers is not a supported setup (#611), but it is a legitimate thing to want on
 * purpose — so the answer is a question rather than a refusal, and the default is no.
 */
export function secondInstancePrompt(port) {
  return [`Port ${port} is already in use — MulmoTerminal may already be running at http://localhost:${port}`, "Start a second instance anyway? [y/N] "].join(
    "\n",
  );
}

/**
 * Whether an answer to that question is a yes.
 *
 * Only an explicit yes counts. The prompt says [y/N], so Enter — and anything unrecognised —
 * means no: starting a second server by misreading a stray keystroke is the outcome worth
 * avoiding, and saying no costs one retyped command.
 */
export function saysYes(answer) {
  return /^y(es)?$/i.test(String(answer ?? "").trim());
}

/**
 * What someone who said yes should know before the second one comes up.
 *
 * One line, and only the part that is still true: config and the hidden-session list are
 * safe across instances, but a session's tool history is cached per process and its live
 * updates never cross — so the instance that did not start a session shows a frozen history
 * for it (#611).
 */
/**
 * The question asked when another server is ALREADY RUNNING, whatever port this one was told to
 * use (#1061).
 *
 * `secondInstancePrompt` below only fires when the wanted port is taken, so `--port <free>`
 * started a second instance in silence — which is how eight live sessions had their settings
 * deleted by a peer's boot. The clash is a symptom; the shared `~/.mulmoterminal` is the thing
 * that is not supported, and that is true at any port.
 */
// npx leaves no `mulmoterminal` on the PATH, so telling an npx user to run `mulmoterminal stop` in
// another terminal names a command they do not have (CodeRabbit). The package directory says which
// they are: npx unpacks into `<cache>/_npx/<hash>/node_modules/mulmoterminal`.
const NPX_INSTALL = /[/\\]_npx[/\\]/;

export const stopCommandFor = (pkgDir) => (NPX_INSTALL.test(String(pkgDir)) ? "npx mulmoterminal@latest stop" : "mulmoterminal stop");

export function runningInstancesPrompt(instances, stopCommand = "mulmoterminal stop") {
  const where = instances.map((i) => (i.port === null ? `pid ${i.pid}` : `http://localhost:${i.port}`)).join(", ");
  const subject = instances.length === 1 ? "MulmoTerminal is already running" : `${instances.length} MulmoTerminal servers are already running`;
  return [
    `${subject} (${where}).`,
    "  Running more than one is NOT a supported setup: they share ~/.mulmoterminal,",
    "  so they can overwrite each other's session state.",
    // This is the moment the user asks how to stop the old one — most often because they are here
    // to run a NEWER version (#1820). Answering it anywhere else means answering it too late.
    `  To stop the running one instead:  ${stopCommand}`,
    "Start another one anyway? [y/N] ",
  ].join("\n");
}

export const SECOND_INSTANCE_NOTE = [
  "  Note: both share ~/.mulmoterminal. A session's tool history does not live-update",
  "  in the instance that did not start it.",
].join("\n");

const MIN_NODE_MAJOR = 22;
const MIN_NODE_MINOR = 12;

/**
 * The lowest Node the `init` check reports as good, for the "needs ≥ x.y" line.
 */
export const MIN_NODE_LABEL = `${MIN_NODE_MAJOR}.${MIN_NODE_MINOR}`;

/**
 * Whether the running Node is new enough for the `init` pre-flight tick.
 *
 * `process.versions.node` is "major.minor.patch", with a "-prerelease" tag on the patch for
 * nightlies ("22.12.0-nightly…"). Only major.minor gate, and Number.parseInt stops at the
 * first non-digit, so that tag never reaches the comparison. A string that is not a version
 * parses to NaN, and every comparison against NaN is false, so an unreadable version reads as
 * "below minimum" — the safe direction for a display-only check.
 */
export function nodeMeetsMinimum(version) {
  const [major, minor] = version.split(".").map((part) => Number.parseInt(part, 10));
  return major > MIN_NODE_MAJOR || (major === MIN_NODE_MAJOR && minor >= MIN_NODE_MINOR);
}

/**
 * The node arguments the launcher spawns the server with.
 *
 * `--env-file-if-exists` is what makes a `.env` in the LAUNCH directory reach the server
 * (#795): the dev scripts have always passed it, the launcher never did, so a key written
 * there was silently absent and the provider stayed unusable. The path is absolute because
 * the spawn runs with `cwd` set to the package directory — a relative `.env` would be looked
 * for inside node_modules and quietly not found.
 *
 * Node options must precede the script path; anything after it is an argument to the script.
 * The launch directory is passed rather than read here so the choice stays checkable.
 *
 * The port goes here rather than in the environment because ARGV IS NOT INHERITED. The server
 * hands its own environment to every PTY it spawns, so a port set there reaches every terminal
 * in every cell — which is how a raw `PORT` made a dev server started in a cell try to take
 * MulmoTerminal's own port (#1857). Renaming it would only move that: `MULMOTERMINAL_PORT` is
 * deliberately given to PTYs (server/session/mcp-config.ts) for the MCP URLs, so a server
 * reading it as its bind port would clash with itself the moment `yarn dev` ran inside a cell.
 */
export function serverNodeArgs(serverEntry, launchDir, port) {
  return ["--import", "tsx", `--env-file-if-exists=${join(launchDir, ".env")}`, serverEntry, "--port", String(port)];
}

/**
 * The environment the launcher spawns the server with.
 *
 * Only the ONE value the server cannot work out for itself. In particular NOT `NODE_ENV`:
 * the server hands its own environment to every PTY it spawns, so a `NODE_ENV=production`
 * set here reaches every terminal in every cell — where yarn v1 reads it and installs
 * WITHOUT devDependencies while still reporting success (#955). Express is pinned to
 * production separately, in the server, so nothing here needs to say it.
 *
 * `PORT` was the same bug with a different name (#1857) and left by the same route; it is now
 * an argument instead (see serverNodeArgs). A `PORT` or `NODE_ENV` the user exported themselves
 * passes through untouched: this decides what the launcher adds, not what it removes.
 */
export function serverSpawnEnv(env, cwd) {
  return { ...env, CLAUDE_CWD: cwd };
}
