// Measure whether a model can actually DRIVE Claude Code, and record how reliably.
//
// A model that answers `-p "say routed"` correctly can still be unusable: the reply comes
// back fine while the tool loop never fires. Measured here, three models did exactly that
// — one printed `Read(file_path=...)` as prose instead of calling the tool. So the probe
// is a task that CANNOT be completed without tools: read a file, write another, and the
// verdict is whether the output file exists with the right contents.
//
// It is also not a single-shot judgement. Two models flipped between PASS and FAIL across
// runs, so each model is tried N times and the preset records the ratio rather than a
// boolean. `common/modelPresets.ts` carries those numbers so the picker can show them.
//
//   yarn tsx scripts/model-trials.ts --provider openrouter --trials 3 <model> [<model>...]
//
// Needs the provider configured in ~/.mulmoterminal/config.json and its token in the
// environment (the same rules resolveProvider enforces at spawn time).
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { claudeAdapter } from "../server/agents/claude.js";
import { loadAppConfig } from "../server/config/app-config.js";
import { cleanupSessionSettings, settingsArgument } from "../server/session/session-settings.js";
import { requireResolution, resolveProvider, withoutUnset } from "../server/session/provider-env.js";

const TRIAL_TIMEOUT_MS = 240_000;
const ANSI = new RegExp(`${String.fromCharCode(0x1b)}\\[[0-9;]*m`, "g");

// Read one file, write another. Neither half is possible without a working tool loop.
const PROBE_WORD = "banana";
const PROBE_TASK =
  "Read the file input.txt in the current directory. It contains one word. " +
  "Write that word, uppercased, into output.txt. Then reply with just the word you wrote.";

// Not reaching a model is not the same as a model failing. OpenRouter answers 404 "No
// endpoints available matching your guardrail restrictions and data policy" when the
// ACCOUNT excludes every provider serving that model — nothing to do with the model, and
// a different account may run it fine. Three models in the first sweep looked broken
// until the real response was read; the preset marks them unverified rather than dropping
// them.
export type TrialStatus = "measured" | "unreachable";

export interface TrialResult {
  model: string;
  status: TrialStatus;
  passed: number;
  of: number;
  medianSeconds: number | null;
  failures: string[];
}

const UNREACHABLE = /No endpoints available|No endpoints found/i;

const median = (values: number[]): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

// One attempt, through the SAME path a real session uses: the provider environment in a
// settings file, the token stripped from the child's own environment.
function attempt(provider: string, model: string): { ok: boolean; seconds: number; detail: string } {
  const config = loadAppConfig(path.join(os.homedir(), ".mulmoterminal", "config.json"));
  const resolved = requireResolution(resolveProvider({ provider, model }, config.providers, process.env));
  const sessionId = `model-trial-${model.replace(/[^a-z0-9]/gi, "-")}`;
  const settings = settingsArgument(sessionId, JSON.stringify({ env: resolved.env, hooks: {} }), true);
  const cwd = mkdtempSync(path.join(os.tmpdir(), "mt-model-trial-"));
  writeFileSync(path.join(cwd, "input.txt"), `${PROBE_WORD}\n`);
  const started = Date.now();
  try {
    execFileSync(claudeAdapter.bin(), ["-p", PROBE_TASK, "--settings", settings, "--model", model, "--dangerously-skip-permissions"], {
      cwd,
      env: withoutUnset(process.env, resolved.unset) as NodeJS.ProcessEnv,
      encoding: "utf8",
      timeout: TRIAL_TIMEOUT_MS,
    });
    const out = path.join(cwd, "output.txt");
    const wrote = existsSync(out) ? readFileSync(out, "utf8").trim() : "";
    const ok = wrote.toUpperCase().includes(PROBE_WORD.toUpperCase());
    return { ok, seconds: Math.round((Date.now() - started) / 1000), detail: ok ? "" : `no tool write (wrote ${JSON.stringify(wrote)})` };
  } catch (err) {
    const e = err as { stderr?: string; stdout?: string; message?: string; signal?: string };
    // Keep the WHOLE message: the interesting part is rarely at the end — the tail is
    // usually Claude Code's benign "connectors are disabled" warning, which hid the real
    // 404 through the first sweep of this script.
    const detail = ((e.stderr ?? "") + (e.stdout ?? "") + (e.message ?? "")).replace(ANSI, "").replace(/\s+/g, " ");
    return { ok: false, seconds: Math.round((Date.now() - started) / 1000), detail: e.signal === "SIGTERM" ? "timeout" : detail };
  } finally {
    cleanupSessionSettings(sessionId);
  }
}

export function runTrials(provider: string, model: string, trials: number): TrialResult {
  const seconds: number[] = [];
  const failures: string[] = [];
  for (let i = 0; i < trials; i += 1) {
    const result = attempt(provider, model);
    if (result.ok) seconds.push(result.seconds);
    else if (UNREACHABLE.test(result.detail)) return { model, status: "unreachable", passed: 0, of: 0, medianSeconds: null, failures: [result.detail] };
    else failures.push(result.detail);
  }
  return { model, status: "measured", passed: seconds.length, of: trials, medianSeconds: median(seconds), failures };
}

const FAILURE_EXCERPT = 120;

// What to add after the numbers: why there are none, or the first thing that went wrong.
function trialNote(result: TrialResult): string {
  if (result.status === "unreachable") return "  unreachable from this account (openrouter.ai/settings/privacy)";
  if (result.failures.length === 0) return "";
  return `  ${result.failures[0].slice(0, FAILURE_EXCERPT)}`;
}

const flag = (name: string, fallback: string): string => {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? fallback : (process.argv[at + 1] ?? fallback);
};

if (process.argv[1]?.endsWith("model-trials.ts")) {
  const provider = flag("provider", "openrouter");
  const trials = Number(flag("trials", "3"));
  const models = process.argv.slice(2).filter((arg, i, all) => !arg.startsWith("--") && !all[i - 1]?.startsWith("--"));
  if (models.length === 0) {
    console.error("usage: yarn tsx scripts/model-trials.ts [--provider <id>] [--trials <n>] <model>...");
    process.exit(1);
  }
  for (const model of models) {
    const result = runTrials(provider, model, trials);
    const rate = result.status === "unreachable" ? "n/a" : `${result.passed}/${result.of}`;
    const speed = result.medianSeconds === null ? "-" : `${result.medianSeconds}s`;
    console.log(`${rate.padEnd(6)} ${speed.padEnd(6)} ${model}${trialNote(result)}`);
  }
}
