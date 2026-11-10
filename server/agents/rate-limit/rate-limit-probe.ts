// The hidden Claude session that harvests the rate-limit windows (#387).
//
// It exists because the windows are only ever handed to a `statusLine` command, and only by an
// INTERACTIVE session that has had at least one API response — both measured. So the probe is a
// real `claude` PTY that is asked one trivial question, reports through the statusLine, and is
// killed. Nobody ever sees its terminal, which is what makes this cheaper than #388's design: that
// one injected the statusLine into the user's own cells and cost each of them a row.
//
// What it costs instead is one small query against the very budget it reports. That is the whole
// reason the caller only asks when a browser is watching (see rate-limit-store.ts) — a probe on a
// timer would spend the user's window overnight to refresh a number nobody is reading.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { killPty } from "../../session/pty/pty-kill.js";
import { statusLineCommand } from "../statusline.js";
import { appendProbeScreen, classifyProbeStall } from "../probe/probe-stall.js";
import type { ProbeStall } from "../../../common/probeStall.js";

// Long enough for a cold `claude` to boot, answer, and re-render its status line; short enough
// that a probe which will never report (no binary, an unaccepted trust prompt, an expired login)
// gives up rather than holding a PTY open.
export const PROBE_TIMEOUT_MS = 90_000;

// The question. Anything answerable without tools, because the point is to cause ONE API response
// — the cheapest thing that makes `rate_limits` appear.
//
// Exported because it is also the only thing that identifies a transcript written by a probe that
// predates `--session-id` (#1010). Change it and those become unrecognisable — which is a reason
// to leave it alone, not a reason to keep the two copies in sync.
export const PROBE_PROMPT = "reply with the single character: .";

// The probe is killed seconds after it answers, and Claude Code's fullscreen renderer counts a
// launch killed before its first 10 seconds as a failed start; two of those on one version switch
// fullscreen off for that login's cells (#2936). This variable makes Claude Code use the classic
// renderer, which sets no such tripwire. The status line is the probe's only output, so the
// renderer cannot change what it reports.
export const PROBE_ENV: Readonly<Record<string, string>> = { CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN: "1" };

/** The environment a probe is started with: the login's own variables, then the renderer pin. */
export const probeSpawnEnv = (loginEnv: Readonly<Record<string, string>> = {}): Record<string, string> => ({ ...loginEnv, ...PROBE_ENV });

export interface ProbePty {
  pid: number;
  kill(signal?: string): void;
  /** The probe's own output. Read only to explain a failure — see probe-stall.ts. */
  onData(listener: (chunk: string) => void): void;
}

/** How a probe ended: what its terminal proved, and the terminal itself for the cases where it
 *  proved nothing. Handed to `onSettled` whether or not the probe succeeded — the store owns the
 *  question of whether anything reported, and this owns the question of what was on screen. */
export interface ProbeOutcome {
  stall: ProbeStall;
  screen: string;
}

export interface ProbeDeps {
  // Injected so a test can drive the lifecycle without a real terminal.
  spawn: (args: string[], cwd: string) => ProbePty;
  host: string;
  port: string | number;
  cwd: string;
  sessionId: string;
  /** An account probe's report key (#2215), carried on its statusLine's URL; absent = default. */
  probeReportKey?: string;
  /** Variables for the settings file's env block — a rotation token (#2919), kept off the child's
   *  own environment, where same-user process inspection could read it. */
  settingsEnv?: Readonly<Record<string, string>>;
  onSettled: (outcome: ProbeOutcome) => void;
}

/**
 * Start one probe. Returns a stop function, called both by the timeout and by the report arriving.
 *
 * Failure has no branch of its own HERE on purpose: a trust prompt nobody answered, a login that
 * expired, a machine too slow to boot the TUI — all of them look the same from inside one probe
 * (no report before the timeout), and all of them want the same response, which is to stop and
 * leave the gauge showing what it had.
 *
 * Telling them apart is the CALLER's job, and it matters: `claude` missing is decided before this
 * runs (a PATH lookup, not a spawn), and "a status line arrived carrying no windows" is decided by
 * the report route. Both used to arrive here as the same silence, which is how a failing probe
 * re-fired every 90 seconds forever (#1011).
 *
 * What this DOES carry out is the screen: the terminal is the only place a stalled probe leaves any
 * evidence at all, so `onSettled` gets what was on it (#1293).
 */
export function startRateLimitProbe(deps: ProbeDeps): () => void {
  // Setup is inside the guard, not before it. It reaches the disk — a full or read-only tmp throws
  // — and the caller has ALREADY marked a probe in flight by the time this runs. An escape here
  // would leave that flag set with nothing to clear it, so the gauge would stop refreshing for the
  // life of the process. Every failure has to arrive as "this probe reported nothing".
  let settings: { dir: string; file: string };
  try {
    const dir = mkdtempSync(path.join(tmpdir(), "mt-ratelimit-"));
    const file = path.join(dir, "settings.json");
    const env = deps.settingsEnv && Object.keys(deps.settingsEnv).length > 0 ? { env: deps.settingsEnv } : {};
    writeFileSync(file, JSON.stringify({ ...env, statusLine: { type: "command", command: statusLineCommand(deps.host, deps.port, deps.probeReportKey) } }), {
      mode: 0o600,
    });
    settings = { dir, file };
  } catch {
    deps.onSettled({ stall: "unknown", screen: "" });
    return () => {};
  }
  const { dir, file: settingsFile } = settings;

  let stopped = false;
  let pty: ProbePty | null = null;
  let screen = "";
  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    clearTimeout(timer);
    // The caller drops its only handle after this, so a probe that ignored SIGHUP would run on
    // untracked — killPty escalates (#2401).
    if (pty) killPty(pty, { label: "rate-limit probe" });
    rmSync(dir, { recursive: true, force: true });
    deps.onSettled({ stall: classifyProbeStall(screen), screen });
  };
  const timer = setTimeout(stop, PROBE_TIMEOUT_MS);

  try {
    // `--session-id` so the transcript claude writes has an id WE chose. Without it claude mints
    // its own, and a session nobody asked for lands in /api/sessions and `claude --resume` with
    // nothing to identify it by (#1010). The caller registers the same id as an internal helper,
    // which is what keeps it out of the listing.
    pty = deps.spawn(probeArgs(deps.sessionId, settingsFile), deps.cwd);
    pty.onData((chunk) => {
      screen = appendProbeScreen(screen, chunk);
    });
  } catch {
    // `claude` is not installed, or cannot be launched at all. Same outcome as any other failure.
    stop();
  }
  return stop;
}

/**
 * How the probe asks its question: as claude's own positional prompt, so the session submits it
 * itself and nothing is ever typed at the terminal.
 *
 * It used to be typed — the prompt written 4 seconds after the spawn and a submit 800ms after that
 * — and the fixed wait is what made the gauge unfixable in some setups (#1293). A TUI that is not
 * accepting input yet DISCARDS the keystrokes: measured on a real pty, typing early leaves
 * `❯ replywiththesinglecharacter:.` in the box (the spaces swallowed too) with the Enter lost, so
 * nothing is ever asked, no API response happens, and the probe can only time out — then back off,
 * retry on the same fixed timings, and fail identically. Anything that slows a claude start past
 * that window (MCP connectors negotiating OAuth, plugin sync, a slow disk) makes the usage readout
 * permanently unavailable with nothing on screen to say why.
 *
 * Sending no keys also means the probe can no longer ANSWER anything: a blind Enter confirms the
 * default choice of whatever dialog is up, and in an untrusted directory that is "Yes, I trust this
 * folder" — verified writing `hasTrustDialogAccepted` for a directory nobody approved.
 *
 * `--strict-mcp-config` for the same reason as the prompt: the probe asks one question that needs
 * no tools, so loading the user's MCP servers (account connectors, plugins, `.mcp.json`) buys
 * nothing and costs startup time — measured at 8.0s to first windows without them and 9-15s with a
 * single unauthenticated one. It affects this hidden session only; the user's own sessions keep
 * every server they have configured.
 */
export const probeArgs = (sessionId: string, settingsFile: string): string[] => [
  "--session-id",
  sessionId,
  "--permission-mode",
  "auto",
  "--strict-mcp-config",
  "--settings",
  settingsFile,
  PROBE_PROMPT,
];
