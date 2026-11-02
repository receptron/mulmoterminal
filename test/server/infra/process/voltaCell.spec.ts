// @vitest-environment node
// Runs only in the `volta` workflow, under `volta run` with a real tmux (#3233). Everywhere else it
// is skipped: it needs Volta, tmux and the network, and its subject is what a cell inherits from a
// server that Volta launched.
import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { sanitizePtyEnv } from "../../../../server/infra/process/pty-env";
import { spawnCaptureAsync } from "../../../../server/infra/process/spawnCapture";
import { sleep } from "../../../../server/infra/process/throwawayTmux";

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

// A cell as the server starts one: a real tmux whose client has the environment a spawn would give it.
// throwawayTmux is not used: it puts this process's node folder first on the PATH for its probes, and
// under `volta run` that folder is exactly the image dir this spec is about.
async function runInCell(dir: string, cwd: string, script: string): Promise<string> {
  const out = path.join(dir, "out.txt");
  const env = sanitizePtyEnv(process.env, path.delimiter);
  const socket = path.join(dir, "s");
  const command = `sh -c '${script} > ${out}.tmp 2>&1; mv ${out}.tmp ${out}'`;
  const started = await spawnCaptureAsync("tmux", ["-S", socket, "new-session", "-d", "-s", "cell", "-c", cwd, command], { env });
  expect(started.status).toBe(0);
  try {
    return await waitForFile(out);
  } finally {
    await spawnCaptureAsync("tmux", ["-S", socket, "kill-server"], { env });
  }
}

const withScratchDir = async (body: (dir: string) => Promise<void>): Promise<void> => {
  const dir = mkdtempSync(path.join(tmpdir(), "mt-volta-"));
  try {
    await body(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

describe.skipIf(!ENABLED)("a cell under `volta run`", () => {
  // Without these the assertions below would pass on a runner where nothing leaks.
  it("starts from a process that carries Volta's marker", () => {
    expect(process.env._VOLTA_TOOL_RECURSION).toBe("1");
  });

  it("starts from a PATH that names a Volta image dir ahead of its shim dir", () => {
    const entries = (process.env.PATH ?? "").split(path.delimiter);
    const imageMarker = `${path.sep}tools${path.sep}image${path.sep}`;
    const image = entries.find((entry) => entry.includes(imageMarker));
    expect(image).toBeDefined();
    const voltaHome = (image ?? "").split(imageMarker)[0] ?? "";
    expect(entries).toContain(path.join(voltaHome, "bin"));
  });

  it("resolves node and npm through Volta's shims, not an image dir", () =>
    withScratchDir(async (dir) => {
      const report = await runInCell(dir, dir, "command -v node npm");
      expect(report).not.toContain(path.join("tools", "image"));
      expect(report.trim().split("\n")).toHaveLength(2);
    }));

  it("runs a project's pinned yarn through Volta's shim, and sees no marker", () =>
    withScratchDir(async (dir) => {
      const project = path.join(dir, "project");
      mkdirSync(project);
      writeFileSync(path.join(project, "package.json"), JSON.stringify({ name: "volta-cell", volta: { node: process.versions.node, yarn: PINNED_YARN } }));
      const report = await runInCell(dir, project, 'yarn -v; echo "marker=${_VOLTA_TOOL_RECURSION:-unset}"');
      expect(report).toContain(PINNED_YARN);
      expect(report).toContain("marker=unset");
    }));
});
