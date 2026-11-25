// @vitest-environment node
// An absolute movie path a dispatch answered is servable only while it is the same file, unchanged
// (#3498): replaced or rewritten since, it is refused.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import express, { type Express } from "express";
import { linkSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { routeCall, jsonPost } from "../../../helpers/routeCall";

const minted = vi.hoisted(() => ({ moviePath: "" }));

vi.mock("@mulmoclaude/mulmoscript-plugin/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@mulmoclaude/mulmoscript-plugin/server")>()),
  createMulmoScriptDispatchHandler: () => async () => ({ ok: true, moviePath: minted.moviePath }),
}));

const { initArtifactsBackend } = await import("../../../../server/backends/plugins/artifacts");
const { initMulmoScriptBackend, mountMulmoScriptDispatchRoute, mountMulmoScriptMediaRoute, registeredStoriesRoots } =
  await import("../../../../server/backends/plugins/mulmoscript");

const MOVIE = "the minted movie";

describe("an absolute media path a dispatch minted", () => {
  let base = "";
  let app: Express;

  beforeEach(async () => {
    base = mkdtempSync(path.join(tmpdir(), "mt-minted-media-"));
    initArtifactsBackend({ workspace: base });
    initMulmoScriptBackend({ workspace: base, pubsub: null, isFfmpegAvailable: () => true });
    const stories = registeredStoriesRoots()[0]?.canonical ?? "";
    mkdirSync(path.join(stories, "out"), { recursive: true });
    minted.moviePath = path.join(stories, "out", "deck.mp4");
    writeFileSync(minted.moviePath, MOVIE);
    app = express();
    app.use(express.json());
    mountMulmoScriptDispatchRoute(app);
    mountMulmoScriptMediaRoute(app);
    expect((await routeCall(app)("/api/plugin/presentMulmoScript", jsonPost({ kind: "status" }))).status).toBe(200);
  });

  afterEach(() => rmSync(base, { recursive: true, force: true }));

  const fetchMovie = () => routeCall(app)(`/api/mulmoscript/media?moviePath=${encodeURIComponent(minted.moviePath)}`);

  it("is served while it is the file that was minted", async () => {
    const res = await fetchMovie();
    expect(res.status).toBe(200);
    expect(res.text).toBe(MOVIE);
  });

  it("is refused once another file took its name", async () => {
    // The old file kept alive under another name, so the new one cannot be handed its freed id.
    linkSync(minted.moviePath, `${minted.moviePath}.kept`);
    rmSync(minted.moviePath);
    writeFileSync(minted.moviePath, MOVIE); // same bytes and size, a different file
    expect((await fetchMovie()).status).toBe(400);
  });

  it("is refused once it was rewritten in place", async () => {
    writeFileSync(minted.moviePath, `${MOVIE}, edited`);
    expect((await fetchMovie()).status).toBe(400);
  });
});
