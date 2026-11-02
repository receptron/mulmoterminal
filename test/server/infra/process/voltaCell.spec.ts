// @vitest-environment node
// Runs only in the `volta` workflow, under `volta run` with a real tmux (#3233). Everywhere else it
// is skipped: it needs Volta, tmux and the network, and its subject is what a cell inherits from a
// server that Volta launched.
import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { throwawayTmux, sleep } from "../../../../server/infra/process/throwawayTmux";

const ENABLED = process.env.MULMO_VOLTA_E2E === "1";
const PINNED_YARN = "1.22.22";
const POLL_INTERVAL_MS = 200;
const POLL_TIMEOUT_MS = 120_000;

async function waitForFile(file: string): Promise<string> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (existsSync(file)) return readFileSync(file, "utf8");
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(`the cell wrote nothing to ${file}`);
}

describe.skipIf(!ENABLED)("a cell under `volta run`", () => {
  // Without these the assertions below would pass on a runner where nothing leaks.
  it("starts from a process that carries Volta's marker", () => {
    expect(process.env._VOLTA_TOOL_RECURSION).toBe("1");
  });

  it("runs a project's pinned yarn through Volta's shim, and sees no marker", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "mt-volta-"));
    try {
      const project = path.join(dir, "project");
      mkdirSync(project);
      writeFileSync(path.join(project, "package.json"), JSON.stringify({ name: "volta-cell", volta: { yarn: PINNED_YARN } }));
      const out = path.join(dir, "out.txt");
      const script = `yarn -v > ${out}.tmp 2>&1; echo "marker=\${_VOLTA_TOOL_RECURSION:-unset}" >> ${out}.tmp; mv ${out}.tmp ${out}`;
      const tmux = throwawayTmux(dir);
      const started = await tmux.run(["new-session", "-d", "-s", "cell", "-c", project, `sh -c '${script}'`]);
      expect(started.ok).toBe(true);
      const report = await waitForFile(out);
      await tmux.run(["kill-server"]);
      expect(report).toContain(PINNED_YARN);
      expect(report).toContain("marker=unset");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
