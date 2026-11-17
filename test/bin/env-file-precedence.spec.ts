// @vitest-environment node
// What `--env-file-if-exists` actually does to a key — pinned against the real node this
// repo runs on, not against the docs. The launcher passes this flag so a `.env` beside the
// user's shell reaches the server (#795), and the whole feature is "which value does the key
// end up with", so a Node release that changed either rule below would change what a user's
// API key is without anything else failing. CI runs Node 24 and 26; this catches both.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { serverNodeArgs } from "../../bin/cli-args.js";

// Read the names back out of a child node, which is the only place the rules apply.
function envFromChild(envFileArgs: string[], env: NodeJS.ProcessEnv): Record<string, string | undefined> {
  const script = "console.log(JSON.stringify({ shared: process.env.MT_SHARED, onlyA: process.env.MT_ONLY_A, onlyB: process.env.MT_ONLY_B }))";
  const out = execFileSync(process.execPath, [...envFileArgs, "-e", script], { env, encoding: "utf8" });
  return JSON.parse(out);
}

describe("node --env-file-if-exists", () => {
  let dir = "";
  let fileA = "";
  let fileB = "";

  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), "mt-envfile-"));
    fileA = path.join(dir, "a.env");
    fileB = path.join(dir, "b.env");
    writeFileSync(fileA, "MT_SHARED=from-a\nMT_ONLY_A=a\n");
    writeFileSync(fileB, "MT_SHARED=from-b\nMT_ONLY_B=b\n");
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("loads a key the environment does not already have", () => {
    expect(envFromChild([`--env-file-if-exists=${fileA}`], { ...process.env }).onlyA).toBe("a");
  });

  // The safety property this feature leans on: adding the flag cannot silently replace a key
  // the user exported in their shell.
  it("does NOT override a name already set in the environment", () => {
    const child = envFromChild([`--env-file-if-exists=${fileA}`], { ...process.env, MT_SHARED: "from-shell" });
    expect(child.shared).toBe("from-shell");
  });

  it("is a no-op for a file that does not exist, rather than an error", () => {
    const missing = path.join(dir, "nope.env");
    expect(() => envFromChild([`--env-file-if-exists=${missing}`], { ...process.env })).not.toThrow();
  });

  // Not used today (the launcher passes exactly one file), but it is the rule any later
  // "also read the workspace .env" would inherit, so record which side would win.
  it("takes the LAST file when several are given, keeping every file's unique keys", () => {
    const child = envFromChild([`--env-file-if-exists=${fileA}`, `--env-file-if-exists=${fileB}`], { ...process.env });
    expect(child).toEqual({ shared: "from-b", onlyA: "a", onlyB: "b" });
  });

  // The arguments the launcher actually builds, run by the actual node, from a DIFFERENT
  // working directory — which is the shape that made the bug invisible to a unit test: the
  // spawn's cwd is the package dir, so only an absolute path finds the user's file. The
  // server itself is never started; this is about the argv, not the app.
  it("loads the launch directory's .env through the launcher's own arguments, spawned from elsewhere", () => {
    const launchDir = mkdtempSync(path.join(tmpdir(), "mt-launch-"));
    writeFileSync(path.join(launchDir, ".env"), "MT_ONLY_A=from-launch-dir\n");
    const stub = path.join(dir, "stub.mjs");
    writeFileSync(stub, "console.log(process.env.MT_ONLY_A ?? '<unset>');\n");
    // --import tsx is dropped: this exercises the .env flag, and loading tsx here would only
    // add a dependency on the transform.
    const args = serverNodeArgs(stub, launchDir, 34567).filter((arg) => arg !== "--import" && arg !== "tsx");
    try {
      const out = execFileSync(process.execPath, args, { cwd: process.cwd(), env: { ...process.env }, encoding: "utf8" });
      expect(out.trim()).toBe("from-launch-dir");
    } finally {
      rmSync(launchDir, { recursive: true, force: true });
    }
  });
});
