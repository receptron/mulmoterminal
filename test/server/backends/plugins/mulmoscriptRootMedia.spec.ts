// @vitest-environment node
// A story in a named stories root: the movie ref a status answers is relative to THAT root, and the
// spelling exists in every root, so the media route resolves it under the root the request names.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import express, { type Express } from "express";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { initArtifactsBackend } from "../../../../server/backends/plugins/artifacts";
import {
  initMulmoScriptBackend,
  mountMulmoScriptDispatchRoute,
  mountMulmoScriptMediaRoute,
  registeredStoriesRoots,
} from "../../../../server/backends/plugins/mulmoscript";
import { routeCall, jsonPost } from "../../../helpers/routeCall";

const DECK = JSON.stringify({ $mulmocast: { version: "1.1" }, title: "Deck", beats: [{ text: "one" }] });

describe("a named root's media", () => {
  let base = "";
  let app: Express;

  beforeEach(() => {
    base = mkdtempSync(path.join(tmpdir(), "mt-rootmedia-"));
    const workspace = path.join(base, "ws");
    mkdirSync(path.join(workspace, "decks", "output", "talk"), { recursive: true });
    writeFileSync(path.join(workspace, "decks", "talk.json"), DECK);
    ["talk.mp4", "talk_en.mp4", "talk_ja.mp4"].forEach((name) => writeFileSync(path.join(workspace, "decks", "output", "talk", name), "NAMED-ROOT-MOVIE"));
    initArtifactsBackend({ workspace });
    initMulmoScriptBackend({ workspace, pubsub: null });
    app = express();
    app.use(express.json({ limit: "25mb" }));
    mountMulmoScriptDispatchRoute(app);
    mountMulmoScriptMediaRoute(app);
  });

  afterEach(() => rmSync(base, { recursive: true, force: true }));

  async function grantedMovie(root: string): Promise<string> {
    const status = await routeCall(app)("/api/plugin/presentMulmoScript", jsonPost({ kind: "movieStatus", filePath: "stories/decks/talk.json", root }));
    const moviePath: unknown = status.body.moviePath;
    if (typeof moviePath !== "string") throw new Error(`no movie: ${JSON.stringify(status.body)}`);
    return moviePath;
  }

  it("serves the movie of the root the request names", async () => {
    const root = registeredStoriesRoots()[0]?.id ?? "";
    const moviePath = await grantedMovie(root);
    const res = await routeCall(app)(`/api/mulmoscript/media?${new URLSearchParams({ moviePath, root })}`);
    expect(res.status).toBe(200);
    expect(res.text).toBe("NAMED-ROOT-MOVIE");
  });

  it("does not find it under the default root", async () => {
    const moviePath = await grantedMovie(registeredStoriesRoots()[0]?.id ?? "");
    const res = await routeCall(app)(`/api/mulmoscript/media?${new URLSearchParams({ moviePath })}`);
    expect(res.status).not.toBe(200);
  });
});
