// @vitest-environment node
import { describe, it, expect, beforeAll } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { initArtifactsBackend } from "./artifacts.js";
import { initMulmoScriptBackend, mountMulmoScriptDispatchRoute, mountMulmoScriptMediaRoute } from "./mulmoscript.js";

const VALID_SCRIPT = { $mulmocast: { version: "1.1" }, title: "Test Story", beats: [{ text: "hello" }] };

function makeApp(): Express {
  const app = express();
  app.use(express.json({ limit: "25mb" }));
  mountMulmoScriptDispatchRoute(app);
  mountMulmoScriptMediaRoute(app);
  return app;
}

describe("before init", () => {
  it("503s the dispatch and media routes", async () => {
    const app = makeApp();
    await request(app).post("/api/plugin/presentMulmoScript").send({ script: VALID_SCRIPT }).expect(503);
    await request(app).get("/api/mulmoscript/media?moviePath=stories/x.mp4").expect(503);
  });
});

describe("mulmoscript backend", () => {
  let app: Express;
  let workspace: string;

  beforeAll(() => {
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), "mt-mulmoscript-"));
    initArtifactsBackend({ workspace });
    initMulmoScriptBackend({ workspace, pubsub: null });
    app = makeApp();
  });

  it("tool-call (no kind) saves a new script and returns the ToolResult envelope", async () => {
    const res = await request(app).post("/api/plugin/presentMulmoScript").send({ script: VALID_SCRIPT, filename: "my-story" }).expect(200);
    expect(res.body.data.filePath).toMatch(/^stories\/my-story-.*\.json$/);
    expect(res.body.message).toContain("Saved MulmoScript");
    expect(res.body.instructions).toContain("Display the storyboard");
    const onDisk = path.join(workspace, "artifacts", res.body.data.filePath);
    expect(JSON.parse(fs.readFileSync(onDisk, "utf8")).title).toBe("Test Story");
  });

  it("tool-call reopens an existing script", async () => {
    const saved = await request(app).post("/api/plugin/presentMulmoScript").send({ script: VALID_SCRIPT }).expect(200);
    const res = await request(app).post("/api/plugin/presentMulmoScript").send({ filePath: saved.body.data.filePath }).expect(200);
    expect(res.body.data.script.title).toBe("Test Story");
  });

  it("tool-call narrates a missing filePath as { message } (no thrown tool call)", async () => {
    const res = await request(app).post("/api/plugin/presentMulmoScript").send({ filePath: "stories/does-not-exist.json" }).expect(200);
    expect(res.body.data).toBeUndefined();
    expect(res.body.message).toContain("not found");
  });

  it("tool-call rejects traversal wire paths via the realpath guard", async () => {
    const res = await request(app).post("/api/plugin/presentMulmoScript").send({ filePath: "stories/../../../etc/passwd" }).expect(200);
    expect(res.body.data).toBeUndefined();
    expect(res.body.message).toBeTruthy();
  });

  it("dispatch (kind present) routes through the package kind router", async () => {
    const saveRes = await request(app).post("/api/plugin/presentMulmoScript").send({ kind: "save", script: VALID_SCRIPT }).expect(200);
    expect(saveRes.body.ok).toBe(true);
    const filePath = saveRes.body.filePath as string;

    const update = await request(app)
      .post("/api/plugin/presentMulmoScript")
      .send({ kind: "updateScript", filePath, script: { ...VALID_SCRIPT, title: "Edited" } })
      .expect(200);
    expect(update.body).toEqual({ ok: true });
    const onDisk = path.join(workspace, "artifacts", filePath);
    expect(JSON.parse(fs.readFileSync(onDisk, "utf8")).title).toBe("Edited");

    const pending = await request(app).post("/api/plugin/presentMulmoScript").send({ kind: "pendingGenerations", filePath }).expect(200);
    expect(pending.body).toEqual({ ok: true, pending: [] });
  });

  it("dispatch answers unknown kinds as ok:false data (no HTTP error)", async () => {
    const res = await request(app).post("/api/plugin/presentMulmoScript").send({ kind: "nonsense" }).expect(200);
    expect(res.body.ok).toBe(false);
    expect(res.body.code).toBe("bad_request");
  });

  it("media route serves movie bytes for a contained wire path", async () => {
    const movieDir = path.join(workspace, "artifacts", "stories", "__movies__");
    fs.mkdirSync(movieDir, { recursive: true });
    fs.writeFileSync(path.join(movieDir, "clip.mp4"), "movie-bytes");
    const res = await request(app).get("/api/mulmoscript/media").query({ moviePath: "stories/__movies__/clip.mp4" }).expect(200);
    expect(res.body.toString()).toBe("movie-bytes");
  });

  it("media route 400s without a path, 404s missing files, and rejects traversal", async () => {
    await request(app).get("/api/mulmoscript/media").expect(400);
    await request(app).get("/api/mulmoscript/media").query({ moviePath: "stories/nope.mp4" }).expect(404);
    await request(app).get("/api/mulmoscript/media").query({ moviePath: "stories/../../../etc/passwd" }).expect(400);
    await request(app).get("/api/mulmoscript/media").query({ pdfPath: "/etc/passwd" }).expect(400);
  });
});
