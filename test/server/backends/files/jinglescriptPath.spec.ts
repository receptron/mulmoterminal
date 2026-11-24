// @vitest-environment node
// manageJingleScript's files on this host's binding (jinglescriptFiles.ts), end to end through
// the plugin: a score named by `path`, and the render files @gui-chat-plugin/jinglescript 1.5
// keeps, both under the CALLING SESSION's directory — the workspace when no session called.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import express from "express";
import { executeManage } from "@gui-chat-plugin/jinglescript";
import { initOpenPathBackend, resetOpenPathBackend } from "../../../../server/backends/files/openPath.js";
import { jingleScriptFileOps, mountJingleScriptCaller, runAsJingleScriptCaller } from "../../../../server/backends/files/jinglescriptFiles.js";
import { SESSION_HEADER } from "../../../../server/backends/files/presentPathRoot.js";
import { isRecord } from "../../../../common/isRecord.js";
import { appRequest } from "../../../helpers/appRequest.js";

const score = {
  format: "jinglescript/1",
  title: "Score from a file",
  tempo: 120,
  length: { beats: 2 },
  tracks: [{ instrument: "marimba", notes: [{ at: 0, pitch: "C5" }] }],
};

const SESSION = "11111111-2222-3333-4444-555555555555";

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

const context = { files: { byPath: jingleScriptFileOps } };

/** The paths a render reports, from the JSON text the plugin answers the model with. */
function reportedFiles(message: string | undefined): { audioFile: string; timingFile: string } {
  const parsed: unknown = JSON.parse(message ?? "{}");
  if (!isRecord(parsed) || typeof parsed.audioFile !== "string" || typeof parsed.timingFile !== "string") {
    throw new Error(`the render reported no files: ${message}`);
  }
  return { audioFile: parsed.audioFile, timingFile: parsed.timingFile };
}

describe("manageJingleScript reading a score by path", () => {
  it("renders the session's score file, named relatively, and keeps its files in the session", async () => {
    mkdirSync(path.join(project, "scores"));
    writeFileSync(path.join(project, "scores", "opening.json"), JSON.stringify(score));
    const result = await runAsJingleScriptCaller(project, () => executeManage(context, { action: "renderScore", path: "scores/opening.json" }));
    expect(result.data?.title).toBe("Score from a file");
    const { audioFile, timingFile } = reportedFiles(result.message);
    expect(audioFile).toMatch(/^jinglescript\/opening\.(mp3|wav)$/);
    expect(timingFile).toBe("jinglescript/opening.timing.json");
    expect(existsSync(path.join(project, audioFile))).toBe(true);
    expect(JSON.parse(readFileSync(path.join(project, timingFile), "utf8")).format).toBe("jinglescript-timing/1");
    expect(existsSync(path.join(ws, "jinglescript"))).toBe(false);
  });

  it("answers in text when the file is missing, and reads nothing but .json", async () => {
    const missing = await executeManage(context, { action: "checkScore", path: path.join(project, "gone.json") });
    expect(missing.data).toBeUndefined();
    expect(missing.message).toContain("Cannot read");
    writeFileSync(path.join(project, "notes.md"), "# not a score");
    await expect(jingleScriptFileOps.read(path.join(project, "notes.md"))).rejects.toThrow();
  });
});

describe("manageJingleScript's render files", () => {
  it("renders a score kept in the area under its own name, not `<stem>-2`", async () => {
    mkdirSync(path.join(project, "jinglescript"));
    writeFileSync(path.join(project, "jinglescript", "song.json"), JSON.stringify(score));
    const result = await runAsJingleScriptCaller(project, () => executeManage(context, { action: "renderScore", path: "jinglescript/song.json" }));
    expect(reportedFiles(result.message).timingFile).toBe("jinglescript/song.timing.json");
  });

  it("never overwrites an earlier render", async () => {
    const render = () => runAsJingleScriptCaller(project, () => executeManage(context, { action: "renderScore", score, fileName: "cue" }));
    expect(reportedFiles((await render()).message).timingFile).toBe("jinglescript/cue.timing.json");
    expect(reportedFiles((await render()).message).timingFile).toBe("jinglescript/cue-2.timing.json");
  });

  it("keeps them in the workspace for a call that names no session", async () => {
    const result = await executeManage(context, { action: "renderScore", score });
    expect(existsSync(path.join(ws, reportedFiles(result.message).audioFile))).toBe(true);
  });

  it("writes after the call returned into the session that made it", async () => {
    let release = (): void => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const late = runAsJingleScriptCaller(project, async () => {
      await gate;
      await jingleScriptFileOps.write("jinglescript/late.wav", "x");
    });
    release();
    await late;
    expect(readFileSync(path.join(project, "jinglescript", "late.wav"), "utf8")).toBe("x");
  });

  it("refuses to write anywhere but the area, or to create a score", async () => {
    await runAsJingleScriptCaller(project, async () => {
      await expect(jingleScriptFileOps.write("jinglescript/sub/a.mp3", "x")).rejects.toThrow("invalid path");
      await expect(jingleScriptFileOps.write("jinglescript/../a.mp3", "x")).rejects.toThrow("invalid path");
      await expect(jingleScriptFileOps.write("a.mp3", "x")).rejects.toThrow("invalid path");
      await expect(jingleScriptFileOps.write("scores/new.json", "{}")).rejects.toThrow();
      expect(await jingleScriptFileOps.exists("jinglescript/../a.mp3")).toBe(false);
    });
    expect(existsSync(path.join(project, "scores"))).toBe(false);
  });

  it("refuses a file in the area that links out of it", async () => {
    const outside = mkdtempSync(path.join(tmpdir(), "mt-jingle-outside-"));
    try {
      mkdirSync(path.join(project, "jinglescript"));
      symlinkSync(outside, path.join(project, "jinglescript", "a.mp3"));
      await runAsJingleScriptCaller(project, () => expect(jingleScriptFileOps.write("jinglescript/a.mp3", "x")).rejects.toThrow());
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

describe("the manageJingleScript route", () => {
  const app = express();
  app.use(express.json());
  mountJingleScriptCaller(app, { cwdForSession: (id) => (id === SESSION ? project : ws) });
  app.post("/api/plugin/:toolName", async (_req, res) => {
    await jingleScriptFileOps.write("jinglescript/routed.wav", "x");
    res.json({ ok: true });
  });
  const request = appRequest(app);
  const post = (tool: string, sessionId?: string) =>
    request(`/api/plugin/${tool}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(sessionId ? { [SESSION_HEADER]: sessionId } : {}) },
      body: "{}",
    });

  it("enters the calling session's directory", async () => {
    expect((await post("manageJingleScript", SESSION)).status).toBe(200);
    expect(existsSync(path.join(project, "jinglescript", "routed.wav"))).toBe(true);
  });

  it("enters the workspace for a malformed or missing session", async () => {
    await post("manageJingleScript", "../not-a-session");
    expect(existsSync(path.join(ws, "jinglescript", "routed.wav"))).toBe(true);
  });

  it("enters nothing for another tool", async () => {
    await post("presentDocument", SESSION);
    expect(existsSync(path.join(project, "jinglescript"))).toBe(false);
    expect(existsSync(path.join(ws, "jinglescript", "routed.wav"))).toBe(true);
  });
});

describe("two manageJingleScript calls in flight at once", () => {
  const SESSION_B = "66666666-7777-8888-9999-000000000000";
  let projectB: string;
  const gates = new Map<string, () => void>();

  beforeEach(() => {
    projectB = mkdtempSync(path.join(tmpdir(), "mt-jingle-project-b-"));
  });
  afterEach(() => {
    rmSync(projectB, { recursive: true, force: true });
    gates.clear();
  });

  const app = express();
  app.use(express.json());
  mountJingleScriptCaller(app, { cwdForSession: (id) => (id === SESSION ? project : id === SESSION_B ? projectB : ws) });
  // Each call parks on its own gate before writing, so both are suspended across an await at the same time.
  app.post("/api/plugin/:toolName", async (req, res) => {
    const session = req.get(SESSION_HEADER) ?? "";
    await new Promise<void>((release) => {
      gates.set(session, release);
    });
    await jingleScriptFileOps.write("jinglescript/routed.wav", "x");
    res.json({ ok: true });
  });
  const request = appRequest(app);
  const post = (sessionId: string) =>
    request("/api/plugin/manageJingleScript", { method: "POST", headers: { "content-type": "application/json", [SESSION_HEADER]: sessionId }, body: "{}" });

  const parked = async (session: string): Promise<() => void> => {
    for (let attempt = 0; attempt < 200 && !gates.has(session); attempt += 1) await new Promise((resolve) => setTimeout(resolve, 5));
    const release = gates.get(session);
    if (!release) throw new Error(`call for ${session} never reached its gate`);
    return release;
  };

  it("keeps each session's writes in its own directory when released in the opposite order", async () => {
    const first = post(SESSION);
    const second = post(SESSION_B);
    const releaseFirst = await parked(SESSION);
    const releaseSecond = await parked(SESSION_B);
    releaseSecond();
    expect((await second).status).toBe(200);
    releaseFirst();
    expect((await first).status).toBe(200);

    expect(existsSync(path.join(project, "jinglescript", "routed.wav"))).toBe(true);
    expect(existsSync(path.join(projectB, "jinglescript", "routed.wav"))).toBe(true);
    expect(existsSync(path.join(ws, "jinglescript"))).toBe(false);
  });
});
