// @vitest-environment node
import { describe, it, expect, beforeAll } from "vitest";
import { makeTempDir } from "../../test/support/tempDir.js";
import express, { type Express } from "express";
import { routeCall, jsonPost } from "../../test/helpers/routeCall.js";
import { isRecord } from "../../common/isRecord.js";
import fs from "node:fs";
import path from "node:path";
import { initArtifactsBackend } from "./artifacts.js";
import { initMulmoScriptBackend, mountMulmoScriptDispatchRoute, mountMulmoScriptMediaRoute } from "./mulmoscript.js";
import { initOpenPathBackend } from "./openPath.js";

const VALID_SCRIPT = { $mulmocast: { version: "1.1" }, title: "Test Story", beats: [{ text: "hello" }] };

function makeApp(): Express {
  const app = express();
  app.use(express.json({ limit: "25mb" }));
  mountMulmoScriptDispatchRoute(app);
  mountMulmoScriptMediaRoute(app);
  return app;
}

/** The `data` object a dispatch answers with, read through a guard rather than a cast: the body is
 *  JSON this spec has not otherwise checked, and every assertion below reads a named field off it. */
const dataOf = (body: Record<string, unknown>): Record<string, unknown> => {
  const data = body.data;
  if (!isRecord(data)) throw new Error(`the route answered no data: ${JSON.stringify(body)}`);
  return data;
};

/** The saved script's path, which the next request sends straight back.
 *
 *  Two shapes, deliberately kept apart: the TOOL-CALL route answers `{ data: { filePath } }` while
 *  the KIND router answers `filePath` at the top level. Reading one through the other's accessor
 *  throws on a body that is perfectly correct (CodeRabbit suggested exactly that on #1799). */
const asFilePath = (value: unknown, body: Record<string, unknown>): string => {
  if (typeof value !== "string") throw new Error(`no filePath in ${JSON.stringify(body)}`);
  return value;
};

const filePathOf = (body: Record<string, unknown>): string => asFilePath(dataOf(body).filePath, body);

describe("before init", () => {
  it("503s the dispatch and media routes", async () => {
    const app = makeApp();
    expect((await routeCall(app)("/api/plugin/presentMulmoScript", jsonPost({ script: VALID_SCRIPT }))).status).toBe(503);
    expect((await routeCall(app)("/api/mulmoscript/media?moviePath=stories/x.mp4")).status).toBe(503);
  });
});

describe("mulmoscript backend", () => {
  let app: Express;
  let workspace: string;

  beforeAll(() => {
    workspace = makeTempDir("mt-mulmoscript-");
    initArtifactsBackend({ workspace });
    // The absolute-`filePath` capability the mulmoScript backend hands the plugin comes from
    // here, so it has to be initialised first — same order as server/index.ts.
    initOpenPathBackend({ workspace });
    initMulmoScriptBackend({ workspace, pubsub: null });
    app = makeApp();
  });

  it("tool-call (no kind) saves a new script and returns the ToolResult envelope", async () => {
    const res = await routeCall(app)("/api/plugin/presentMulmoScript", jsonPost({ script: VALID_SCRIPT, filename: "my-story" }));
    expect(res.status).toBe(200);
    expect(dataOf(res.body).filePath).toMatch(/^stories\/my-story-.*\.json$/);
    expect(res.body.message).toContain("Saved MulmoScript");
    expect(res.body.instructions).toContain("Display the storyboard");
    const onDisk = path.join(workspace, "artifacts", filePathOf(res.body));
    expect(JSON.parse(fs.readFileSync(onDisk, "utf8")).title).toBe("Test Story");
  });

  it("tool-call reopens an existing script", async () => {
    const saved = await routeCall(app)("/api/plugin/presentMulmoScript", jsonPost({ script: VALID_SCRIPT }));
    expect(saved.status).toBe(200);
    const res = await routeCall(app)("/api/plugin/presentMulmoScript", jsonPost({ filePath: filePathOf(saved.body) }));
    expect(res.status).toBe(200);
    const script = dataOf(res.body).script;
    expect(isRecord(script) && script.title).toBe("Test Story");
  });

  it("tool-call narrates a missing filePath as { message } (no thrown tool call)", async () => {
    const res = await routeCall(app)("/api/plugin/presentMulmoScript", jsonPost({ filePath: "stories/does-not-exist.json" }));
    expect(res.status).toBe(200);
    expect(res.body.data).toBeUndefined();
    expect(res.body.message).toContain("not found");
  });

  it("tool-call rejects traversal wire paths via the realpath guard", async () => {
    const res = await routeCall(app)("/api/plugin/presentMulmoScript", jsonPost({ filePath: "stories/../../../etc/passwd" }));
    expect(res.status).toBe(200);
    expect(res.body.data).toBeUndefined();
    expect(res.body.message).toBeTruthy();
  });

  it("dispatch (kind present) routes through the package kind router", async () => {
    const saveRes = await routeCall(app)("/api/plugin/presentMulmoScript", jsonPost({ kind: "save", script: VALID_SCRIPT }));
    expect(saveRes.status).toBe(200);
    expect(saveRes.body.ok).toBe(true);
    const filePath = asFilePath(saveRes.body.filePath, saveRes.body);

    const update = await routeCall(app)(
      "/api/plugin/presentMulmoScript",
      jsonPost({ kind: "updateScript", filePath, script: { ...VALID_SCRIPT, title: "Edited" } }),
    );
    expect(update.status).toBe(200);
    expect(update.body).toEqual({ ok: true });
    const onDisk = path.join(workspace, "artifacts", filePath);
    expect(JSON.parse(fs.readFileSync(onDisk, "utf8")).title).toBe("Edited");

    const pending = await routeCall(app)("/api/plugin/presentMulmoScript", jsonPost({ kind: "pendingGenerations", filePath }));
    expect(pending.status).toBe(200);
    expect(pending.body).toEqual({ ok: true, pending: [] });
  });

  it("dispatch answers unknown kinds as ok:false data (no HTTP error)", async () => {
    const res = await routeCall(app)("/api/plugin/presentMulmoScript", jsonPost({ kind: "nonsense" }));
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(false);
    expect(res.body.code).toBe("bad_request");
  });

  it("media route serves movie bytes for a contained wire path", async () => {
    const movieDir = path.join(workspace, "artifacts", "stories", "__movies__");
    fs.mkdirSync(movieDir, { recursive: true });
    fs.writeFileSync(path.join(movieDir, "clip.mp4"), "movie-bytes");
    const res = await routeCall(app)(`/api/mulmoscript/media?${new URLSearchParams({ moviePath: "stories/__movies__/clip.mp4" })}`);
    expect(res.status).toBe(200);
    expect(res.text).toBe("movie-bytes");
  });

  it("media route 400s without a path, 404s missing files, and rejects traversal", async () => {
    expect((await routeCall(app)("/api/mulmoscript/media")).status).toBe(400);
    expect((await routeCall(app)(`/api/mulmoscript/media?${new URLSearchParams({ moviePath: "stories/nope.mp4" })}`)).status).toBe(404);
    expect((await routeCall(app)(`/api/mulmoscript/media?${new URLSearchParams({ moviePath: "stories/../../../etc/passwd" })}`)).status).toBe(400);
    expect((await routeCall(app)(`/api/mulmoscript/media?${new URLSearchParams({ pdfPath: "/etc/passwd" })}`)).status).toBe(400);
  });
});

// Re-inits the module-level backend, so this describe must run AFTER the ones
// above (vitest runs describes in file order within a file).
describe("autoGenerateMovie without ffmpeg", () => {
  it("saves the script but reports that movie generation was not started", async () => {
    const workspace = makeTempDir("mt-mulmoscript-noffmpeg-");
    initArtifactsBackend({ workspace });
    initMulmoScriptBackend({ workspace, pubsub: null, isFfmpegAvailable: () => false });
    const app = makeApp();

    const res = await routeCall(app)("/api/plugin/presentMulmoScript", jsonPost({ script: VALID_SCRIPT, autoGenerateMovie: true }));
    expect(res.status).toBe(200);
    expect(dataOf(res.body).filePath).toMatch(/^stories\/.*\.json$/);
    expect(res.body.message).toContain("movie generation was NOT started");
    expect(res.body.message).toContain("ffmpeg");
    // The doomed background job must not have run: no error sidecar next to the script.
    const sidecar = path.join(workspace, "artifacts", `${filePathOf(res.body)}.error.txt`);
    expect(fs.existsSync(sidecar)).toBe(false);
  });
});

// ── The absolute `filePath` form (plugin 4.6.0) ──────────────────────────────────────────────
//
// A deck kept in a repo, or written by another tool, opened where it lies. Through 4.5.2 every
// absolute path was refused, so these also pin that RELATIVE paths did not change meaning.
describe("absolute filePath", () => {
  let app: Express;
  let workspace: string;
  let outside: string;
  /** `outside`'s parent, so the traversal test's `..` lands somewhere this spec owns and can
   *  put a REAL deck — a traversal refused for the wrong reason (no such file) proves nothing. */
  let outsideParent: string;

  beforeAll(() => {
    workspace = makeTempDir("mt-mulmoscript-abs-ws-");
    outsideParent = makeTempDir("mt-mulmoscript-abs-out-");
    outside = path.join(outsideParent, "decks");
    fs.mkdirSync(outside, { recursive: true });
    initArtifactsBackend({ workspace });
    initOpenPathBackend({ workspace });
    initMulmoScriptBackend({ workspace, pubsub: null });
    app = makeApp();
  });

  const deckAt = (name: string, script: unknown = VALID_SCRIPT): string => {
    const file = path.join(outside, name);
    fs.writeFileSync(file, JSON.stringify(script));
    return file;
  };

  it("opens a .json script that lives outside every stories directory", async () => {
    const deck = deckAt("keynote.json", { ...VALID_SCRIPT, title: "Outside Deck" });
    const res = await routeCall(app)("/api/plugin/presentMulmoScript", jsonPost({ filePath: deck }));
    expect(res.status).toBe(200);
    const script = dataOf(res.body).script;
    expect(isRecord(script) && script.title).toBe("Outside Deck");
    // The wire path comes back as the absolute path itself: there is no stories-relative
    // spelling for a file outside the stories dir, and minting one would read back as a
    // DIFFERENT file.
    expect(dataOf(res.body).filePath).toBe(deck);
  });

  it("writes a beat edit back to the file it was given, not into artifacts/stories", async () => {
    const deck = deckAt("editable.json");
    const res = await routeCall(app)("/api/plugin/presentMulmoScript", jsonPost({ filePath: deck, beatIndex: 0, beat: { text: "edited in place" } }));
    expect(res.status).toBe(200);
    expect(JSON.parse(fs.readFileSync(deck, "utf8")).beats[0].text).toBe("edited in place");
    expect(fs.existsSync(path.join(workspace, "artifacts", "stories", "editable.json"))).toBe(false);
  });

  it("accepts the same absolute path through the View's dispatch router", async () => {
    // The tool call and the View must agree: one file, one answer. They build their execute
    // context separately, which is exactly how they came to disagree before.
    const deck = deckAt("dispatched.json");
    const res = await routeCall(app)("/api/plugin/presentMulmoScript", jsonPost({ kind: "save", filePath: deck }));
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.filePath).toBe(deck);
  });

  it("narrates a missing absolute path rather than inventing a file", async () => {
    const res = await routeCall(app)("/api/plugin/presentMulmoScript", jsonPost({ filePath: path.join(outside, "gone.json") }));
    expect(res.status).toBe(200);
    expect(res.body.data).toBeUndefined();
    expect(res.body.message).toContain("not found");
  });

  it("refuses an absolute path with a traversal segment, even when the target is a real deck", async () => {
    // A VALID deck at the normalised target, so the refusal can only come from the `..` segment.
    // Without it the path resolves to nothing and the test passes with the guard deleted — green
    // for the wrong reason (CodeRabbit on #1971).
    const target = path.join(outsideParent, "escape.json");
    fs.writeFileSync(target, JSON.stringify(VALID_SCRIPT));
    expect(fs.existsSync(target)).toBe(true);
    // `path.format`, not `path.join`: joining normalises the `..` away and tests nothing.
    const traversal = path.format({ dir: outside, base: path.join("..", "escape.json") });
    expect(path.resolve(traversal)).toBe(target);

    const res = await routeCall(app)("/api/plugin/presentMulmoScript", jsonPost({ filePath: traversal }));
    expect(res.status).toBe(200);
    expect(res.body.data).toBeUndefined();
    // And the same file IS readable when named without the `..`, so the refusal is about the
    // spelling rather than about the file.
    const direct = await routeCall(app)("/api/plugin/presentMulmoScript", jsonPost({ filePath: target }));
    expect(dataOf(direct.body).filePath).toBe(target);
  });

  it("leaves a relative filePath meaning artifacts/stories", async () => {
    // The regression that matters most: the workspace's own stories are addressed by a relative
    // path, and an identically-named deck sits outside. They must stay two different files.
    deckAt("collision.json", { ...VALID_SCRIPT, title: "Outside" });
    const saved = await routeCall(app)("/api/plugin/presentMulmoScript", jsonPost({ script: { ...VALID_SCRIPT, title: "Inside" }, filename: "collision" }));
    const relative = filePathOf(saved.body);
    expect(relative).toMatch(/^stories\/collision-.*\.json$/);
    const res = await routeCall(app)("/api/plugin/presentMulmoScript", jsonPost({ filePath: relative }));
    const script = dataOf(res.body).script;
    expect(isRecord(script) && script.title).toBe("Inside");
    expect(fs.existsSync(path.join(workspace, "artifacts", relative))).toBe(true);
  });
});
