#!/usr/bin/env node

// MulmoTerminal launcher — `npx mulmoterminal` entry point.
//
// Ships the server source (TypeScript) + a pre-built client (Vite dist/), and
// runs the server via tsx. Mirrors the mulmoclaude launcher.

import { execSync, spawn } from "node:child_process";
import { accessSync, constants, existsSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { release } from "node:os";
import { delimiter as pathDelimiter, dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { computeUpdateNotice, isUpdateCheckDisabled } from "./update-check.js";
import { detectNpxCacheDir, npxCacheHintLines } from "./npx-cache-hint.js";
import { waitUntilReady } from "./wait-ready.js";
import {
  bindHostFor,
  chooseCwd,
  launchTarget,
  companionHostsFor,
  launcherReachHost,
  probeFailureIsPortInUse,
  parsePortArg,
  portInUseAction,
  portInUseMessage,
  saysYes,
  secondInstancePrompt,
  runningInstancesPrompt,
  stopCommandFor,
  SECOND_INSTANCE_NOTE,
  nodeMeetsMinimum,
  MIN_NODE_LABEL,
  serverNodeArgs,
  serverSpawnEnv,
} from "./cli-args.js";
import { liveInstances } from "./instances.js";
import { setProcessTitle } from "./process-title.js";
import { AGENT_COMMANDS, agentBin, canRun, firstInstalledAgent, installedAgents, probeEnvFrom } from "./agent-commands.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_DIR = join(__dirname, "..");
const SERVER_ENTRY = join(PKG_DIR, "server", "index.ts");
const DEFAULT_PORT = 34567;
// The address every port question in this file is about. Read once: a probe that asked about a
// different address than the server binds is #1876, and asking the same variable the server asks
// is what stops that drifting again. Keep the default in step with BIND_HOST in
// server/config/env.ts — a spec asserts the two agree.
const BIND_HOST = bindHostFor(process.env);
// Printed wherever the user is told how to stop a server, so it names a command they actually have.
const STOP_COMMAND = stopCommandFor(PKG_DIR);
// Server exit code meaning "port taken at bind time" — keep in sync with
// server/index.ts (PORT_IN_USE_EXIT_CODE).
const PORT_IN_USE_EXIT_CODE = 75;
// How long to wait for the child to report the address it bound before falling back to guessing
// from BIND_HOST. The message is posted from inside the listen callback, so it arrives when the
// server becomes ready — this only has to outlast boot, which is seconds. Generous because the
// cost of being early is the guess this whole change exists to avoid, and the cost of being late
// is nothing: the banner is gated on an HTTP 200 either way.
const REPORTED_ADDRESS_GRACE_MS = 20_000;

// Only the end of stderr matters for the crash diagnosis; a long-lived server can log
// arbitrarily much before dying, so the tail is bounded.
const STDERR_TAIL_MAX_BYTES = 64 * 1024;

// Single source of truth: read the version from the shipped package.json so
// `--version` never drifts from the published version.
const { version: VERSION } = createRequire(import.meta.url)("../package.json");

// An IPC payload is whatever the other side sent, so its shape is checked rather than assumed.
const isRecordLike = (value) => typeof value === "object" && value !== null;

const log = (msg) => console.log(`\x1b[36m[mulmoterminal]\x1b[0m ${msg}`);
const error = (msg) => console.error(`\x1b[31m[mulmoterminal]\x1b[0m ${msg}`);

// Non-blocking console notice that a newer version exists — neither `npm i -g` nor a git
// checkout auto-updates. Opt out via MULMOTERMINAL_NO_UPDATE_CHECK / NO_UPDATE_NOTIFIER. The
// same check runs in the server for the web-header badge (the launcher isn't involved under
// `yarn dev`), sharing computeUpdateNotice so the two never drift.
async function checkForUpdate() {
  if (isUpdateCheckDisabled(process.env)) return;
  try {
    const notice = await computeUpdateNotice(PKG_DIR, VERSION);
    if (notice) log(`\x1b[33m${notice}\x1b[0m`);
  } catch {
    // best-effort; never disrupt startup
  }
}

// Detect a CLI on the user's PATH by asking for its version. Intentionally resolves from
// PATH — detecting the user's installed tools is the whole point of the pre-flight /
// `init` checks.
// A `--version` that never returns hangs whoever asked. That was survivable while this only ran
// against a fixed list of tools; it is not, now that `<AGENT>_BIN` and seven agent names reach it,
// any of which may be a stale shim on someone's PATH. Measured against the shipped code: a `grok`
// on PATH that blocks 30 seconds held `npx mulmoterminal init` for 30 seconds without this.
//
// Generous on purpose — a cold npm shim on Windows is slow, and calling a working agent missing is
// worse than waiting for it. A probe that times out is reported MISSING, which is the honest
// answer: a binary that cannot say its version in five seconds cannot back a terminal either.
const VERSION_PROBE_TIMEOUT_MS = 5000;

function hasCommand(cmd, versionArg = "--version", env = process.env) {
  try {
    execSync(`${cmd} ${versionArg}`, { stdio: "pipe", timeout: VERSION_PROBE_TIMEOUT_MS, killSignal: "SIGKILL", env });
    return true;
  } catch {
    return false;
  }
}

// The environment an AGENT probe runs in: PATH with the run-script injections stripped, so the
// launcher looks where the spawn will look. Without it, `npx mulmoterminal` in a directory whose
// `node_modules/.bin` is on PATH EXECUTED that directory's `codex --version` at the gate — a binary
// `sanitizePtyEnv` exists to keep out of a spawn (Codex review, round 6).
//
// Computed once: PATH is a start-up setting here like `<AGENT>_BIN`, and the probe runs per agent.
const probeEnv = probeEnvFrom(process.env, pathDelimiter);

// PATH tools the app shells out to; mirrors the requirements table in README.md. `required`
// ones back the core grid — without them a developer loses whole views rather than one
// feature — so a miss is an ✗, not an ○.
const PATH_TOOLS = [
  { cmd: "git", versionArg: "--version", required: true, why: "worktrees, per-cell branch/diff, PR footer", hint: "brew install git  ·  apt install git" },
  { cmd: "gh", versionArg: "--version", required: true, why: "PRs & Issues view + one-click PRs", hint: "https://cli.github.com  (then: gh auth login)" },
  // Optional rather than a second required tool: github.com is what the app is built around, and a
  // user with no GitLab project should not be told they are missing something (#981).
  {
    cmd: "glab",
    versionArg: "--version",
    required: false,
    why: "the PRs & Issues view for gitlab.com projects",
    hint: "brew install glab  (then: glab auth login)",
  },
  { cmd: "tmux", versionArg: "-V", required: false, why: "sessions survive a restart", hint: "brew install tmux  ·  apt install tmux" },
  {
    cmd: "ffmpeg",
    versionArg: "-version",
    required: false,
    why: "video rendering in the mulmo-script panel",
    hint: "brew install ffmpeg  ·  apt install ffmpeg",
  },
  { cmd: "ollama", versionArg: "--version", required: false, why: "a fully local model via claude-ollama", hint: "https://ollama.com/download" },
];

// The variables WSL exports into a login shell, then the kernel that names itself
// (`…-microsoft-standard-WSL2`, `…-Microsoft` on WSL1) for the processes those variables never
// reach. Mirrors `isWsl()` in server/files/wsl.ts, which this file cannot import: bin runs as
// plain JS, the server runs through tsx. Keep the two in step.
function isWslHost() {
  if (process.platform !== "linux") return false;
  return Boolean(process.env.WSL_DISTRO_NAME || process.env.WSL_INTEROP) || /microsoft/i.test(release());
}

// The file dialog is the one requirement that differs per host, so it is checked per host rather
// than listed above: macOS and Windows have one built in and can't be missing it. WSL reaches the
// Windows dialog over interop, and a Linux desktop has whichever toolkit it was installed with —
// zenity's absence there is what makes the picker look broken (#1447).
function fileDialogTool() {
  if (process.platform === "darwin" || process.platform === "win32") return null;
  const why = "the file / folder picker";
  if (isWslHost()) {
    return {
      cmd: "powershell.exe",
      versionArg: "-NoProfile -Command exit",
      required: false,
      why: `${why}, using the Windows dialog`,
      hint: "enable WSL interop (wsl.conf), or: sudo apt install zenity",
    };
  }
  return {
    cmd: "zenity",
    versionArg: "--version",
    required: false,
    why: `${why} (kdialog / qarma / yad also work)`,
    hint: "sudo apt install zenity  ·  sudo dnf install zenity",
  };
}

function toolCheckLine({ cmd, versionArg, required, why, hint }) {
  if (hasCommand(cmd, versionArg)) return `  ✓ ${cmd} — ${why}`;
  const head = required ? `  ✗ ${cmd} — not found, needed for ${why}` : `  ○ ${cmd} — optional (${why})`;
  return `${head}\n      → ${hint}`;
}

// How the launcher asks whether an agent can be started, and it is deliberately NOT just
// `hasCommand`: a `<AGENT>_BIN` that NAMES A PATH must be asked of the filesystem, because
// `hasCommand` builds a shell string and a path with a space in it gets split. The server answers
// that same path with `true`, so spawning it through the shell here made the two disagree in the
// one direction that matters — refusing to start for someone whose agent is installed.
const agentProbe = (bin) =>
  canRun(
    bin,
    {
      isFile: (candidate) => {
        try {
          return statSync(candidate).isFile();
        } catch {
          return false;
        }
      },
      isExecutable: (candidate) => {
        try {
          accessSync(candidate, constants.X_OK);
          return true;
        } catch {
          return false;
        }
      },
      runsOnPath: (name) => hasCommand(name, "--version", probeEnv),
    },
    process.platform,
  );

// The startup gate is "at least one agent", not "Claude Code" (#2082). The server needs none of
// them to start, and a machine running only Codex or GitHub Copilot CLI was being turned away at the
// door. A missing one simply fails to start that CELL, with a message naming the binary and its
// `<AGENT>_BIN` — which is the sentence that helps, at the moment it helps.
//
// Still a gate rather than nothing: with no agent at all there is nothing to launch, and a reason
// beats an empty grid.
function requireAnAgent() {
  // The FIRST one, not all of them. The question here is "is there anything to launch", and probing
  // the rest lets an optional agent nobody asked for delay startup — measured at 30,059 ms with a
  // hanging `grok` on PATH and `claude` already found. `init` is what reports the whole list.
  const found = firstInstalledAgent(process.env, agentProbe);
  if (found !== null) {
    log(`Agent CLI ✓  ${found.agent}   (\`npx mulmoterminal init\` lists them all)`);
    return;
  }
  error("No agent CLI found — MulmoTerminal has nothing to launch.");
  error("Install at least one:");
  AGENT_COMMANDS.forEach(({ agent, hint }) => error(`  ${agent.padEnd(12)}${hint}`));
  error("Already installed somewhere else? Point <AGENT>_BIN at it, e.g. CLAUDE_BIN=/opt/bin/claude");
  process.exit(1);
}

function promptYesNo(question) {
  return new Promise((res) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      res(saysYes(answer));
    });
  });
}

// `npx mulmoterminal init` — idempotent first-run setup. Environment/CLI checks + the
// optional interactive-config launch live here (PATH-command detection); the config
// derivation + write is the tsx-run server/cli-init.ts.
async function runInit(initArgs) {
  log("Setting up MulmoTerminal…\n");

  const nodeOk = nodeMeetsMinimum(process.versions.node);
  console.log(nodeOk ? `  ✓ Node ${process.versions.node}` : `  ✗ Node ${process.versions.node} — MulmoTerminal needs ≥ ${MIN_NODE_LABEL}`);

  // Every agent, not just Claude Code (#2082): the app needs ONE of them, so reporting one by name
  // and the rest nowhere told a Codex user they were missing something they were not.
  const agents = installedAgents(process.env, agentProbe);
  AGENT_COMMANDS.forEach(({ agent, cmd, env, hint }) => {
    const found = agents.some((installed) => installed.agent === agent);
    const named = process.env[env] ? `${cmd} (${env})` : cmd;
    console.log(found ? `  ✓ ${agent} — ${named}` : `  ○ ${agent} — optional (${named} not found)\n      → ${hint}`);
  });
  if (agents.length === 0) console.log("  ✗ no agent CLI at all — install one of the above, or point <AGENT>_BIN at one you have");

  [...PATH_TOOLS, fileDialogTool()].filter(Boolean).forEach((tool) => console.log(toolCheckLine(tool)));

  // Config half: derive working-dir presets from Claude history + write config.json.
  console.log("");
  const initExit = await new Promise((res) => {
    const child = spawn(process.execPath, ["--import", "tsx", join(PKG_DIR, "server", "cli-init.ts"), ...initArgs], {
      cwd: PKG_DIR,
      env: { ...process.env },
      stdio: "inherit",
    });
    child.on("exit", (code) => res(code ?? 0));
  });
  if (initExit) {
    process.exitCode = initExit;
    error("Setup did not complete — see the error above.");
    return;
  }

  // Offer the interactive skill only in a real terminal; a non-TTY run (CI / piped input)
  // must never block waiting on stdin.
  // This offer is Claude Code's specifically — the skill runs inside it — so it asks about that one
  // agent rather than about `agents`, and spawns the binary the rest of the app would run.
  const claude = agents.find(({ agent }) => agent === "claude");
  if (claude && process.stdin.isTTY && (await promptYesNo("\nConfigure interactively now with the /mulmoterminal-config skill? [y/N] "))) {
    log("Launching Claude — use  /mulmoterminal-config  (or just ask it to configure MulmoTerminal).");
    spawn(agentBin(claude, process.env), ["Use the mulmoterminal-config skill to configure MulmoTerminal."], { stdio: "inherit" });
    return;
  }
  if (claude) log("Later: run `claude` in any project and use  /mulmoterminal-config");
  // Pinned to @latest: an unpinned `npx` reuses whatever it already has cached, so the very
  // command printed for someone to type next would start an older version than the one they
  // just set up with.
  log("Setup done. Start MulmoTerminal:  npx mulmoterminal@latest");
}

// `npx mulmoterminal google <command>` — Google account linking. Consent needs a
// loopback listener on this machine, so it can't be driven from the web UI (a phone
// browser can't reach 127.0.0.1 here); the flow lives in the tsx-run server/cli-google.ts.
function runGoogle(googleArgs) {
  return new Promise((res) => {
    const child = spawn(process.execPath, ["--import", "tsx", join(PKG_DIR, "server", "cli-google.ts"), ...googleArgs], {
      cwd: PKG_DIR,
      env: { ...process.env },
      stdio: "inherit",
    });
    child.on("exit", (code) => {
      process.exitCode = code ?? 0;
      res();
    });
  });
}

// WSL has no Linux browser to open (and often no `xdg-open` either), so the URL goes to the
// Windows shell — `start` through cmd.exe, which is what opens the user's real browser. It exits
// 0, unlike `explorer.exe`, so a failure here still means a failure.
function pickOpenCommand() {
  if (process.platform === "darwin") return "open";
  if (process.platform === "win32") return "start";
  if (isWslHost()) return 'cmd.exe /c start ""';
  return "xdg-open";
}

// Resolve with true if the SERVER could bind `port`, false otherwise — which is the question
// choosePort needs answered, and not the same as "is anyone using this port". A bind collides
// only with the same address (measured), so the probe uses the one the server will use. It
// bound the `::` wildcard until #1876, which answered "free" for a port a running MulmoTerminal
// held on loopback and so kept the second-instance guard from ever firing.
// Resolves { free, address } — `address` is what the OS says this bind LANDED ON, which is the
// only answer that survives every spelling of a host (`0:0:0:0:0:0:0:0` reports `::`, `localhost`
// reports `::1`, `127.1` reports `127.0.0.1`). Null when the probe could not ask.
function canBind(port, host) {
  return new Promise((resolve) => {
    const probe = createServer();
    // A failed probe is not automatically a taken port — see probeFailureIsPortInUse.
    probe.once("error", (err) => resolve({ free: !probeFailureIsPortInUse(err), address: null }));
    probe.once("listening", () => {
      const bound = probe.address();
      const address = bound !== null && typeof bound !== "string" ? bound.address : null;
      probe.close(() => resolve({ free: true, address }));
    });
    probe.listen(port, host);
  });
}

// Free means free on the requested address AND on every companion that address implies — see
// companionHostsFor, which is asked about what the kernel bound rather than about what was typed.
// Sequential rather than parallel: two probes racing for the same port would report the second
// busy against the first, which is this file's own bug wearing a different hat.
//
// Resolves { free, address } so the caller learns the concrete address too: it is the honest
// fallback for the readiness poll, and unlike BIND_HOST it needs no interpreting.
async function isPortFree(port) {
  const primary = await canBind(port, BIND_HOST);
  if (!primary.free || primary.address === null) return primary;
  for (const host of companionHostsFor(primary.address)) {
    if (!(await canBind(port, host)).free) return { free: false, address: primary.address };
  }
  return primary;
}

// Can `localhost` reach anything OTHER than the server this launcher is about to start? (#1889)
//
// The browser is sent to `localhost` so a user's saved layout stays where it has always been, and
// `localhost` resolves to BOTH `::1` and `127.0.0.1` (measured). `isPortFree` already proves
// `127.0.0.1` is free for every launch — `companionHostsFor` requires it — but nothing asks about
// `::1`, so a stranger holding the v6 loopback could answer a browser that resolves that way.
//
// Asked by BINDING rather than by classifying the host string, which is this file's rule
// throughout: free means nobody is there, and that is true whether the server is about to take
// `::1` itself (a `::1` or `::` bind) or leave it empty. Both are answers the browser can only
// reach us with. A machine with no IPv6 fails EADDRNOTAVAIL, which probeFailureIsPortInUse
// correctly reports as "not in use" — and there `localhost` is v4-only, so it is unambiguous.
//
// Must run BEFORE the server is spawned, or the server's own `::1` listener answers the probe.
async function localhostReachesOnlyUs(port) {
  return (await canBind(port, "::1")).free;
}

function printReadyBanner(url, stopCommand) {
  const bar = "\x1b[32m" + "─".repeat(48) + "\x1b[0m";
  console.log(`\n${bar}`);
  console.log(`\x1b[32m  ✓ MulmoTerminal is ready\x1b[0m`);
  console.log(`\x1b[32m  → ${url}\x1b[0m`);
  console.log(`\x1b[32m  Press Ctrl+C to stop — or \`${stopCommand}\` from any terminal.\x1b[0m`);
  console.log(`${bar}\n`);
}

// The two flag decisions live in cli-args.js so they can be checked without a process to
// exit; this turns a decision into the message and the exit.
function decideOrExit(choice) {
  if ("error" in choice) {
    error(choice.error);
    process.exit(1);
  }
  return choice;
}

// Resolve the workspace directory claude runs in (and whose sessions the sidebar
// lists), always absolute. An explicit --cwd that isn't an existing directory is a hard
// error (catches typos before launch); an inherited one is the workspace the server creates.
function resolveCwd(args) {
  const { path: chosen, mustExist } = decideOrExit(chooseCwd(args, process.env));
  const abs = resolve(process.cwd(), chosen);
  if (mustExist && (!existsSync(abs) || !statSync(abs).isDirectory())) {
    error(`--cwd is not a directory: ${abs}`);
    process.exit(1);
  }
  return abs;
}

// Ask the OS for a free port (listen on 0) and return the one it assigned, or null. Only
// reached once someone has said yes to a second instance.
//
// On BIND_HOST for the same reason isPortFree is (#1876): a port the OS calls free on the
// wildcard can be taken on the address the server will actually bind, and handing back one of
// those sends the user to a second instance that cannot start.
//
// And the number it comes back with is then run through isPortFree, which checks EVERY address
// this launch needs (probeHostsFor). Asking the OS for a free port only asks about one of them,
// so a wildcard bind could otherwise be handed a number whose loopback is already held — the
// same shadowing that put a stranger behind the ready banner.
async function findEphemeralPort() {
  const offered = await new Promise((resolve) => {
    const probe = createServer();
    probe.once("error", () => resolve(null));
    probe.once("listening", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
    probe.listen(0, BIND_HOST);
  });
  if (offered === null) return null;
  const checked = await isPortFree(offered);
  return checked.free ? { port: offered, address: checked.address } : null;
}

// Ask about an ALREADY-RUNNING server, whatever port this one will use. Declining exits 0: the
// user answered the question that was asked, which is not a failure.
async function confirmNoRunningInstance() {
  const running = liveInstances();
  if (running.length === 0) return;
  if (!process.stdin.isTTY) {
    log(runningInstancesPrompt(running, STOP_COMMAND).replace(/\nStart another one anyway\? \[y\/N\] $/, ""));
    log(SECOND_INSTANCE_NOTE);
    return;
  }
  if (!(await promptYesNo(runningInstancesPrompt(running, STOP_COMMAND)))) process.exit(0);
  log(SECOND_INSTANCE_NOTE);
}

async function pickPort(requested, explicit) {
  const asked = await isPortFree(requested);
  if (asked.free) return { port: requested, address: asked.address };
  // No SILENT fallback: starting a second server on another port without saying so is how
  // someone ends up with two sharing one home directory without knowing (#611).
  if (portInUseAction(explicit, process.stdin.isTTY) === "stop") {
    error(portInUseMessage(requested, explicit));
    process.exit(1);
  }
  if (!(await promptYesNo(secondInstancePrompt(requested)))) process.exit(1);
  const fallback = await findEphemeralPort();
  if (fallback === null) {
    error("No free port could be found for a second instance.");
    process.exit(1);
  }
  log(SECOND_INSTANCE_NOTE);
  return fallback;
}

// The port, the address a probe of it landed on, and whether `localhost` can reach anything but us
// on it — settled together because all three have to be known BEFORE the spawn, which is the only
// moment `::1` can be asked about honestly (see localhostReachesOnlyUs).
async function choosePort(requested, explicit) {
  const chosen = await pickPort(requested, explicit);
  return { ...chosen, localhostIsUnambiguous: await localhostReachesOnlyUs(chosen.port) };
}

// What the launcher does the moment the server answers: say where it is, and open it there.
//
// `url` is where the BROWSER goes and `note` is what launchTarget wants said about that choice —
// two different facts since #1889, and the note is null whenever the URL already covers it.
function announceReady(url, note, noOpen) {
  printReadyBanner(url, STOP_COMMAND);
  // Either the address a widened bind serves other machines on, or why the browser was NOT sent
  // to `localhost`. Null whenever the URL above already said everything.
  if (note) log(note);
  if (noOpen) return;
  try {
    // The command is a hardcoded literal; url is built by browserUrl from a numeric port, so it
    // is http://localhost:<n>.
    execSync(`${pickOpenCommand()} ${url}`, { stdio: "pipe" });
  } catch {
    log(`Open your browser: ${url}`);
  }
}

// Spawn the server on `port` and report the child via `onChild` (so signal
// handlers target the live process). Resolves only when the server exits because
// the port was taken at bind time before it became ready — the caller then
// reports that and stops. In every other case (clean shutdown, fatal error,
// or the server simply running) the process exits with the server's code.
function runServer(port, probedAddress, localhostIsUnambiguous, noOpen, cwd, onChild) {
  return new Promise((resolveExit) => {
    log(`Starting MulmoTerminal on port ${port}...`);
    // stderr is piped (and passed through) so a fatal boot error can be inspected once the
    // child closes — a half-unpacked npx cache entry crashes here with ERR_MODULE_NOT_FOUND,
    // and without reading stderr the launcher cannot tell that from a real bug.
    // The .env comes from where the user ran the command — the spawn's own cwd is the
    // package directory, so serverNodeArgs makes that path absolute (#795).
    const server = spawn(process.execPath, serverNodeArgs(SERVER_ENTRY, process.cwd(), port), {
      cwd: PKG_DIR,
      env: serverSpawnEnv(process.env, cwd),
      // "ipc" is the fourth entry and the reason the readiness check can stop guessing: the
      // server posts { type: "listening", address } from inside its listen callback, and only it
      // knows what BIND_HOST actually resolved to. Without a channel here that message is a
      // no-op, which is what its own comment in server/index.ts says.
      stdio: ["inherit", "inherit", "pipe", "ipc"],
    });
    let stderrTail = "";
    server.stderr.on("data", (chunk) => {
      process.stderr.write(chunk);
      stderrTail = (stderrTail + chunk.toString()).slice(-STDERR_TAIL_MAX_BYTES);
    });
    onChild(server);

    // The address to check is the one the CHILD REPORTS, not one derived from BIND_HOST — three
    // rounds of review found three different spellings BIND_HOST can take that a guess gets
    // wrong (`::` vs `::1`, `localhost` resolving per-platform, a printed `localhost` that a
    // browser re-resolves). server/infra/loopback.ts already argued this for its own question:
    // "classifying the requested string cannot be made right … asking after the fact answers all
    // of them, because the kernel has already resolved whatever was typed" (#1876).
    //
    // The BIND_HOST guess survives only as the fallback for a server that sends nothing, and it
    // starts on a timer so such a server is not left without a banner.
    let readyStarted = false;
    let cancelReady = () => {};
    // Takes a CONCRETE address — callers resolve first, and a caller that cannot does not call.
    //
    // Two different questions, and #1889 is what happens when one answer is given to both. The
    // POLL asks "did the server we started come up", so it uses the address the child reported
    // binding — that is #1876's fix and it stays. The URL asks "where does this user's browser
    // keep its state", and the only answer that does not empty the app is the one it has always
    // been given: see browserUrl.
    // `serverSaysLocalhostIsOurs` is the child's own report and OUTRANKS the probe when present.
    // The probe ran before the child existed, so it cannot see a process that claimed EITHER
    // loopback during the boot — only the child knows how its own binds went (Codex, PR #1903).
    // `undefined` means the child said nothing about it, and then the probe is all there is.
    const beginReady = (reachHost, serverSaysLocalhostIsOurs) => {
      if (readyStarted) return;
      readyStarted = true;
      const localhostIsOurs = localhostIsUnambiguous && serverSaysLocalhostIsOurs !== false;
      const { url, note } = launchTarget(reachHost, port, localhostIsOurs);
      cancelReady = waitUntilReady(port, () => announceReady(url, note, noOpen), { host: reachHost });
    };
    server.on("message", (msg) => {
      if (!isRecordLike(msg) || msg.type !== "listening" || typeof msg.address !== "string") return;
      const reported = launcherReachHost(msg.address);
      // Absent rather than false when the field is missing, so "an older child said nothing" and
      // "this child could not take it" stay different answers.
      if (reported) beginReady(reported, typeof msg.localhostIsOurs === "boolean" ? msg.localhostIsOurs : undefined);
    });
    // The fallback runs ONLY on an address we can name without asking anyone. Guessing from a
    // NAME is what the child's report exists to replace, and a fallback that guessed anyway just
    // re-opened the hole on a slow boot (round 5, P1): with MULMOTERMINAL_HOST=localhost the
    // child can bind `::1` while a stranger owns 127.0.0.1, and an unresolved `localhost` poll
    // reaches the stranger. So a name gets no fallback — it gets a sentence saying why.
    // The probe's own answer first — it came from the kernel, so it needs no interpreting and it
    // covers every spelling BIND_HOST could have been. launcherReachHost only turns a wildcard
    // into something connectable; BIND_HOST is the last resort and returns null for a name.
    const guessed = probedAddress ? launcherReachHost(probedAddress) : launcherReachHost(BIND_HOST);
    const fallbackReady = setTimeout(() => {
      // No report, so no v6 answer either — the probe is all this path ever had.
      if (guessed) return beginReady(guessed, undefined);
      if (!readyStarted)
        log(`Started, but ${BIND_HOST} is a name and the server has not reported which address it bound — not guessing. It may still be starting.`);
    }, REPORTED_ADDRESS_GRACE_MS);
    fallbackReady.unref?.();

    // `close`, not `exit`: it fires only once the piped stderr has fully drained, so the
    // whole crash output — including a trailing `_npx/<hash>` line that can arrive after
    // `exit` — is in `stderrTail` before we inspect it.
    server.on("close", (code) => {
      cancelReady();
      // Exit code 75 means this child failed to bind (EADDRINUSE) and never
      // served — always retriable, regardless of what a probe to the port saw
      // (another process could have answered it). Other exits are terminal.
      if (code === PORT_IN_USE_EXIT_CODE) {
        resolveExit();
        return;
      }
      if (code !== 0) {
        const cacheDir = detectNpxCacheDir(stderrTail);
        if (cacheDir) npxCacheHintLines(cacheDir, process.platform).forEach((line) => error(line));
      }
      process.exit(code ?? 1);
    });
  });
}

function printHelp() {
  console.log(`
Usage: npx mulmoterminal@latest [command] [options]

Commands:
  (none)            Start the server (default)
  init              First-run setup: check your environment, seed working-directory
                    presets from your Claude Code history, and write
                    ~/.mulmoterminal/config.json (idempotent — safe to re-run)
  stop [--force]    Stop the running server(s), from any terminal — you do not have
                    to find the one you started it in ("stop --help" for the rest)
  google login      Link a Google account (browser consent, on this machine) so the
                    Calendar tool and the phone's google.calendar.* commands can run
  room <cmd>        Take part in a conversation room from a shell:
                    room read <id> / room post <id> <text…> / room list.
                    Needs a running server

Options:
  --cwd <dir>       Working directory claude runs in (default: current directory; relative paths allowed)
  --port <number>   Server port (default: ${DEFAULT_PORT}; the PORT environment variable is
                    used when this flag is absent). If it is in use, you are asked
                    whether to start a second instance on a free port; with a port
                    named, or with no terminal to ask, startup stops instead.
  --no-open         Don't open the browser automatically
  --version         Show version
  --help            Show this help
`);
}

/**
 * Where a port nobody typed on this command line came from.
 *
 * A `PORT` can arrive from a shell profile or direnv, so the number alone leaves the user no way
 * to see why we wanted it (#1861 review). Both facts are said out loud because they are separate
 * surprises: we are asking for a port they may have meant for something else, and — unlike a
 * `--port` launch — that variable is still in every cell, since it is theirs and the launcher
 * only decides what it ADDS (see serverSpawnEnv).
 *
 * It says ASKING FOR, not taking. This prints before confirmNoRunningInstance, choosePort and the
 * bind, any of which can end the launch — so "taking" was a completed action claimed twenty lines
 * before anything was attempted (Codex round 2). Printing it later instead would lose it on the
 * busy-port path, which is the one where "why does it want 34601?" is the actual question.
 */
function notePortFromEnvironment(port) {
  log(`Port ${port} comes from the PORT environment variable — that is the port MulmoTerminal is asking for.`);
  log(`  Terminals inside cells inherit that PORT too, as in any shell you exported it from.`);
}

async function main() {
  const args = process.argv.slice(2);

  if (args[0] === "init") {
    await runInit(args.slice(1));
    return;
  }

  if (args[0] === "google") {
    await runGoogle(args.slice(1));
    return;
  }

  if (args[0] === "stop") {
    const { runStop } = await import("./stop.js");
    await runStop(args.slice(1));
    return;
  }

  if (args[0] === "room") {
    const { runRoom } = await import("./room.js");
    await runRoom(args.slice(1));
    return;
  }

  if (args.includes("--help") || args.includes("-h")) {
    printHelp();
    return;
  }
  if (args.includes("--version")) {
    console.log(`mulmoterminal ${VERSION}`);
    return;
  }

  checkForUpdate();

  requireAnAgent();

  if (!existsSync(SERVER_ENTRY)) {
    error(`Server entry not found at ${SERVER_ENTRY}`);
    process.exit(1);
  }

  const { port: requestedPort, explicit: portExplicit } = decideOrExit(parsePortArg(args, process.env, DEFAULT_PORT));
  if (portExplicit && !args.includes("--port")) notePortFromEnvironment(requestedPort);
  const noOpen = args.includes("--no-open");
  const cwd = resolveCwd(args);
  log(`Workspace: ${cwd}`);

  // Registered once; always targets the live child across bind-retries.
  let child = null;
  const shutdown = () => {
    child?.kill("SIGTERM");
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // The probe above can still lose to something binding the port in the same instant, in
  // which case the server exits 75 and runServer returns. Same answer as the probe: say who
  // has it rather than moving to a port nobody asked for.
  // Before anything about PORTS: is one already running at all? A clash on the same port is only
  // the visible half — `--port <free>` used to start a second instance in silence, and the two
  // then share ~/.mulmoterminal (#1061). Non-TTY says it and carries on rather than hanging on a
  // prompt nobody can answer: a script that asked for a server should still get one.
  await confirmNoRunningInstance();

  // The address comes back with the port because the PROBE learned it from the kernel, which is
  // the one answer that needs no interpreting (#1876). It is the fallback the readiness poll uses
  // when the child reports nothing.
  const { port, address: probedAddress, localhostIsUnambiguous } = await choosePort(requestedPort, portExplicit);
  // Named only now, because the port is half the name — and named at all so that the user who
  // loses this terminal has something to search for (#1820). The server child names itself the
  // same, so `pkill mulmoterminal` reaches whichever half is found first.
  setProcessTitle(port);
  await runServer(port, probedAddress, localhostIsUnambiguous, noOpen, cwd, (c) => {
    child = c;
  });
  error(portInUseMessage(port, portExplicit));
  process.exit(1);
}

main();
