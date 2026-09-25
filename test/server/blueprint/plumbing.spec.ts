// @vitest-environment node
// The executor's real edges: the run store on disk, the check runner through /bin/sh, and the
// ask command an agent pastes — sent at a real HTTP server, with a question that would break
// naive quoting.
import { describe, it, expect, afterEach } from "vitest";
import { execFile } from "node:child_process";
import { createServer, type Server } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRunStore } from "../../../server/blueprint/runStore";
import { runCheck } from "../../../server/blueprint/checkRunner";
import { askCommand } from "../../../server/blueprint/wiring";
import { isTrustedByClaude } from "../../../server/blueprint/trust";
import { initialState } from "../../../common/blueprint/state";
import type { BlueprintRun } from "../../../common/blueprint/run";

const dirs: string[] = [];
const tempDir = async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "blueprint-"));
  dirs.push(dir);
  return dir;
};
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const steps = [{ id: "a", title: "A", description: "", skill: "skills/a", check: "true", gates: [], origin: "base" as const }];
const run = (id: string): BlueprintRun => ({
  id,
  projectDir: "/p",
  basePackDir: "/b",
  usecasePackDir: "/u",
  steps,
  failedChecks: {},
  activeSessionId: null,
  sessions: [],
  createdAtMs: 1,
});

describe("runStore", () => {
  it("round-trips a run and its state", async () => {
    const store = createRunStore(await tempDir());
    await store.save(run("run-00000001"), initialState(steps));
    expect(await store.load("run-00000001")).toEqual({ run: run("run-00000001"), state: initialState(steps) });
    expect(await store.list()).toEqual(["run-00000001"]);
  });

  it("answers null for a run that does not exist or an id that could escape the directory", async () => {
    const store = createRunStore(await tempDir());
    expect(await store.load("run-00000404")).toBeNull();
    expect(await store.load("../../etc")).toBeNull();
  });

  it("names the run when its files are corrupt", async () => {
    const root = await tempDir();
    const store = createRunStore(root);
    await store.save(run("run-00000001"), initialState(steps));
    await writeFile(path.join(root, "run-00000001", "build.json"), "{ not json");
    await expect(store.load("run-00000001")).rejects.toThrow("run-00000001");
  });
});

describe.skipIf(process.platform === "win32")("runCheck", () => {
  it("passes on exit 0 and hands the check both pack directories", async () => {
    const cwd = await tempDir();
    const result = await runCheck({ command: 'echo "$BLUEPRINT_BASE|$BLUEPRINT_USECASE|$(pwd)"', cwd, basePackDir: "/packs/b", usecasePackDir: "/packs/u" });
    expect(result.ok).toBe(true);
    expect(result.output).toContain("/packs/b|/packs/u|");
  });

  it("ends the whole process group on a timeout, not only the shell", async () => {
    const started = Date.now();
    const result = await runCheck({ command: "sleep 30 & sleep 30", cwd: await tempDir(), basePackDir: "/b", usecasePackDir: "/u" }, 300);
    expect(result.ok).toBe(false);
    expect(result.output).toContain("timed out");
    expect(Date.now() - started).toBeLessThan(10_000);
  });

  it("does not wait on a descendant that left the process group and holds the pipes", async () => {
    const started = Date.now();
    const escape = 'node -e \'require("child_process").spawn("sleep", ["30"], { detached: true, stdio: "inherit" }).unref()\'; echo done';
    const result = await runCheck({ command: escape, cwd: await tempDir(), basePackDir: "/b", usecasePackDir: "/u" }, 20_000);
    expect(result).toEqual({ ok: true, output: "done\n" });
    expect(Date.now() - started).toBeLessThan(10_000);
  });

  it("does not wait on a descendant the check left running", async () => {
    const started = Date.now();
    const result = await runCheck({ command: "(sleep 30 &); echo done", cwd: await tempDir(), basePackDir: "/b", usecasePackDir: "/u" }, 20_000);
    expect(result).toEqual({ ok: true, output: "done\n" });
    expect(Date.now() - started).toBeLessThan(10_000);
  });

  it("fails on a non-zero exit and keeps what the check printed", async () => {
    const result = await runCheck({ command: "echo missing thing >&2; exit 3", cwd: await tempDir(), basePackDir: "/b", usecasePackDir: "/u" });
    expect(result.ok).toBe(false);
    expect(result.output).toContain("missing thing");
  });
});

describe.skipIf(process.platform === "win32")("askCommand", () => {
  let server: Server | undefined;
  afterEach(() => server?.close());

  it.each([
    [34999, "run 1", "a"],
    [34999, "run-00000001", "a;rm"],
    ["1; rm", "run-00000001", "a"],
  ])("refuses to build a command from unsafe arguments (%s, %s, %s)", (port, runId, stepId) => {
    expect(() => askCommand(port, runId, stepId)).toThrow("unsafe");
  });

  it("delivers the question intact, quotes and all, to the run's ask route", async () => {
    const received: { url: string; body: unknown }[] = [];
    server = createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        received.push({ url: req.url ?? "", body: JSON.parse(body) });
        res.end("{}");
      });
    });
    await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    const question = `Use "asia-northeast1" or it's 'us-central1'? $HOME \`x\``;
    await new Promise<void>((resolve, reject) =>
      execFile("/bin/sh", ["-c", askCommand(port, "run-00000001", "projects")], { env: { ...process.env, QUESTION: question } }, (err) =>
        err ? reject(err) : resolve(),
      ),
    );
    expect(received).toEqual([{ url: "/api/blueprints/runs/run-00000001/ask", body: { stepId: "projects", question } }]);
  });
});

describe("isTrustedByClaude", () => {
  const projects = { "/Users/me/ss": { hasTrustDialogAccepted: true }, "/Users/me/ss/untrusted": { hasTrustDialogAccepted: false } };

  it.each([
    ["the trusted directory itself", "/Users/me/ss", true],
    ["a new directory under it", "/Users/me/ss/llm/new-app", true],
    ["a child whose own entry says false, under a trusted parent", "/Users/me/ss/untrusted", true],
    ["a sibling of it", "/Users/me/other", false],
    ["a prefix that is not an ancestor", "/Users/me/ssx/app", false],
    ["the root", "/", false],
  ])("%s", (_label, dir, expected) => {
    expect(isTrustedByClaude(dir, projects)).toBe(expected);
  });

  it.each([null, undefined, [], "x", { "/": { hasTrustDialogAccepted: "true" } }])("trusts nothing from %o", (value) => {
    expect(isTrustedByClaude("/Users/me/ss", value)).toBe(false);
  });
});
