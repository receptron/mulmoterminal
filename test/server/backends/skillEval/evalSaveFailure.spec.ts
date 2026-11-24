// @vitest-environment node
// A run record that cannot be written for a moment (#3458). On Windows a reader holding the file makes the
// rename onto it fail with EPERM; here the write is made to fail on cue. A progress save that does not land
// must not end the measurement, and the last save is tried again until the record no longer says running.
import { describe, it, expect, afterEach, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { SkillEvalRun } from "../../../../common/skillEval";
import type { AttemptDeps } from "../../../../server/backends/skillEval/evalAttempt";

const failing = vi.hoisted(() => ({ writes: 0, failOn: new Set<number>() }));

vi.mock("../../../../server/backends/skillEval/evalStore", async (importActual) => {
  const actual = await importActual<typeof import("../../../../server/backends/skillEval/evalStore")>();
  return {
    ...actual,
    writeRun: async (evalDir: string, run: SkillEvalRun) => {
      failing.writes += 1;
      if (failing.failOn.has(failing.writes)) throw Object.assign(new Error("EPERM: operation not permitted, rename"), { code: "EPERM" });
      return actual.writeRun(evalDir, run);
    },
  };
});

const { startEvalRun } = await import("../../../../server/backends/skillEval/evalRunner");
const { readEvalSet, readRun, textHash } = await import("../../../../server/backends/skillEval/evalStore");

const dirs: string[] = [];
afterEach(() => {
  dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }));
  failing.writes = 0;
  failing.failOn.clear();
});

function scratch(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "mt-skill-save-"));
  dirs.push(dir);
  return dir;
}

const SET = {
  version: 1,
  skill: "weekly",
  repeats: 2,
  cases: [{ id: "plain", title: "Plain", kind: "use", prompt: "Do it", check: { type: "command", command: "true" } }],
};
const done = JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "done", total_cost_usd: 0.1, permission_denials: [] });

async function run(): Promise<SkillEvalRun | null> {
  const evalDir = scratch();
  writeFileSync(path.join(evalDir, "cases.json"), JSON.stringify(SET));
  const skillDir = path.join(scratch(), "weekly");
  mkdirSync(skillDir);
  writeFileSync(path.join(skillDir, "SKILL.md"), "Do it.");
  const read = await readEvalSet(evalDir, "weekly");
  if (read.kind !== "ok") throw new Error("the set did not parse");
  const deps: AttemptDeps = {
    ...{ claudeBin: "claude", tmpRoot: scratch(), now: Date.now },
    runClaude: () => Promise.resolve({ stdout: done, exitCode: 0, failure: null }),
    runCommand: () => Promise.resolve({ ok: true, output: "" }),
  };
  const start = { evalDir, set: read.set, setHash: read.hash, skillDir, skillSlug: "weekly", skillText: "Do it.", skillHash: textHash("Do it.") };
  const started = await startEvalRun(start, deps);
  await started?.done;
  return readRun(evalDir, started?.id ?? "");
}

// Writes: 1 is the record made at the start, then one per attempt (4 here), then the last.
describe("a run record that cannot be written for a moment", () => {
  it("goes on measuring when a progress save does not land", async () => {
    failing.failOn = new Set([2, 3]);
    expect(await run()).toMatchObject({ status: "done", interruptedBy: "" });
  });

  it("tries the last save again rather than leaving the record running", async () => {
    failing.failOn = new Set([6, 7]);
    const record = await run();
    expect(record).toMatchObject({ status: "done" });
    expect(record?.attempts).toHaveLength(4);
  });
});
