// @vitest-environment node
// manageJingleScript's `path` form (@gui-chat-plugin/jinglescript 0.6.0): checkScore /
// renderScore read a `.json` score through the host's `files.byPath`. Asserted end to end
// on this host's binding: a relative path is made absolute against the session's directory
// (presentPathRoot.ts), read through `jingleScriptByPath` (openPath.ts), and rendered.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { executeManage } from "@gui-chat-plugin/jinglescript";
import { initOpenPathBackend, resetOpenPathBackend, jingleScriptByPath, JINGLESCRIPT_SCORE_EXTENSIONS } from "../../../../server/backends/files/openPath.js";
import { absolutizePresentPath } from "../../../../server/backends/files/presentPathRoot.js";
import { isRecord } from "../../../../common/isRecord.js";

const score = {
  format: "jinglescript/1",
  title: "Score from a file",
  tempo: 120,
  length: { beats: 2 },
  tracks: [{ instrument: "marimba", notes: [{ at: 0, pitch: "C5" }] }],
};

let ws: string;
let project: string;

beforeEach(() => {
  ws = mkdtempSync(path.join(tmpdir(), "mt-jingle-ws-"));
  project = mkdtempSync(path.join(tmpdir(), "mt-jingle-project-"));
  resetOpenPathBackend();
  initOpenPathBackend({ workspace: ws });
});

afterEach(() => {
  resetOpenPathBackend();
  for (const dir of [ws, project]) rmSync(dir, { recursive: true, force: true });
});

describe("manageJingleScript reading a score by path", () => {
  it("renders the session's score file, named relatively", async () => {
    mkdirSync(path.join(project, "scores"));
    writeFileSync(path.join(project, "scores", "opening.json"), JSON.stringify(score));
    const args = absolutizePresentPath({ action: "renderScore", path: "scores/opening.json" }, project, JINGLESCRIPT_SCORE_EXTENSIONS);
    if (!isRecord(args)) throw new Error("the rewrite must keep the arguments an object");
    expect(args.path).toBe(path.join(project, "scores", "opening.json"));
    const result = await executeManage({ files: { byPath: jingleScriptByPath } }, args);
    expect(result.data?.title).toBe("Score from a file");
    expect(result.data?.midi.startsWith("data:audio/midi;base64,")).toBe(true);
  });

  it("answers in text when the file is missing, and reads nothing but .json", async () => {
    const missing = await executeManage({ files: { byPath: jingleScriptByPath } }, { action: "checkScore", path: path.join(project, "gone.json") });
    expect(missing.data).toBeUndefined();
    expect(missing.message).toContain("Cannot read");
    writeFileSync(path.join(project, "notes.md"), "# not a score");
    await expect(jingleScriptByPath.read(path.join(project, "notes.md"))).rejects.toThrow();
  });
});
