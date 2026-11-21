// @vitest-environment node
// /api/library/repeats (#3334) on a real in-memory index and a prompt log on disk: the candidates, one
// with its occurrences, and the promote that starts the skill on one — guarded, in plan mode, in the
// directory it was typed in most.
import { describe, it, expect, afterEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import express from "express";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { routeCall } from "../../helpers/routeCall";
import { mountLibraryRoutes } from "../../../server/routes/library-routes";
import { applyTranscriptScan, finishLease, prepareLibraryStore, takeLease } from "../../../server/backends/library/index-store";
import { createLibraryIndex } from "../../../server/backends/library/library-index";
import { createLocalLibraryService } from "../../../server/backends/library/library-service";
import { localLibraryCaller } from "../../../server/backends/library/library-dispatch";
import { emptyConversationState } from "../../../server/backends/library/conversation-fold";
import { AUTOMATED_ENTRYPOINT } from "../../../common/library";
import { isRepeatCandidate, isRepeatDetail } from "../../../common/libraryRepeats";
import { REPEAT_LISTED_MAX } from "../../../server/backends/library/repeat-detect";
import { createHash } from "node:crypto";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

const NOW = Date.parse("2026-11-21T00:00:00Z");
const MERGE = "CIが通ったらマージして";

/** A prompt log: MERGE typed in three conversations of `project`, and again in an automated one. */
function setup(allowed = true) {
  const root = mkdtempSync(path.join(tmpdir(), "mt-repeats-"));
  dirs.push(root);
  const project = path.join(root, "app");
  mkdirSync(project);
  const line = (sessionId: string, display: string, minutesAgo: number) =>
    JSON.stringify({ sessionId, display, project, timestamp: NOW - minutesAgo * 60_000 });
  const lines = ["a", "b", "c", "auto"].flatMap((sessionId, at) => [
    line(sessionId, MERGE, at * 10 + 1),
    line(sessionId, `and then ${sessionId.repeat(9)}`, at * 10 + 2),
  ]);
  const historyFile = path.join(root, "history.jsonl");
  writeFileSync(historyFile, `${lines.join("\n")}\n`);
  const db = new DatabaseSync(":memory:");
  prepareLibraryStore(db);
  takeLease(db, "t", 0, Number.MAX_SAFE_INTEGER);
  ["a", "auto"].forEach((id) =>
    applyTranscriptScan(db, {
      ...{ path: `/p/${id}.jsonl`, id, agent: "claude", parentId: null, isTemporary: false },
      ...{ stamp: { size: 1, mtimeMs: 1 }, head: "h", owner: "t", expectedScannedTo: null, to: 1, restart: true },
      state: { ...emptyConversationState(), cwd: project, entrypoint: id === "auto" ? AUTOMATED_ENTRYPOINT : "cli" },
      turns: [],
    }),
  );
  finishLease(db, "t", 0);
  const index = { ...createLibraryIndex(db, { projectsRoot: "/absent", historyFile, temporaryRoots: [], owner: "t", now_ms: () => 0 }), refresh: () => {} };
  const spawned: unknown[][] = [];
  const app = express();
  app.use(express.json());
  mountLibraryRoutes(app, {
    call: localLibraryCaller(createLocalLibraryService(index, { historyFile, temporaryRoots: [], now: () => NOW })),
    promote: {
      spawnSession: (...args) => (spawned.push(args), Promise.resolve({ sessionId: "new-session", agent: "claude", seedRuns: true })),
      isAllowedOrigin: () => allowed,
    },
  });
  const request = routeCall(app);
  const post = (id: string, body: unknown) =>
    request(`/api/library/repeats/${id}/promote`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { request, post, spawned, project, root };
}

async function mergeId(request: ReturnType<typeof setup>["request"]): Promise<string> {
  const answer = await request("/api/library/repeats");
  const candidates: unknown = answer.body.candidates;
  const merge = Array.isArray(candidates) ? candidates.filter(isRepeatCandidate).find((c) => c.text === MERGE) : undefined;
  if (merge === undefined) throw new Error("expected the merge instruction to be a candidate");
  return merge.id;
}

describe("GET /api/library/repeats", () => {
  it("finds an instruction typed in three conversations, leaving the automated one out", async () => {
    const { request, project } = setup();
    const answer = await request("/api/library/repeats");
    expect(answer.status).toBe(200);
    expect(answer.body.candidates).toEqual([expect.objectContaining({ text: MERGE, count: 3, sessions: 3, projects: [project] })]);
    expect(answer.body.total).toBe(1);
  });

  it("lists the most typed up to the bound, and says how many there are", async () => {
    const { request, root, project } = setup();
    const extra = REPEAT_LISTED_MAX + 1;
    const lines = Array.from({ length: extra }, (_, at) => {
      const text = `do ${createHash("sha256").update(String(at)).digest("hex").slice(0, 24)}`;
      return ["x", "y", "z"].flatMap((session) => [
        JSON.stringify({ sessionId: `${session}${String(at)}`, display: text, project, timestamp: NOW - at }),
        JSON.stringify({
          sessionId: `${session}${String(at)}`,
          display: createHash("sha256")
            .update(`${session}${String(at)}`)
            .digest("hex"),
          project,
          timestamp: NOW - at,
        }),
      ]);
    });
    writeFileSync(path.join(root, "history.jsonl"), `${lines.flat().join("\n")}\n`);
    const answer = await request("/api/library/repeats");
    expect(answer.body.total).toBe(extra);
    expect(Array.isArray(answer.body.candidates) ? answer.body.candidates.length : -1).toBe(REPEAT_LISTED_MAX);
  });

  it("answers one with each time it was typed, newest first, and 404 / 400 otherwise", async () => {
    const { request } = setup();
    const id = await mergeId(request);
    const detail = await request(`/api/library/repeats/${id}`);
    expect(isRepeatDetail(detail.body)).toBe(true);
    expect(detail.body).toMatchObject({ occurrences: [{ sessionId: "a" }, { sessionId: "b" }, { sessionId: "c" }] });
    expect((await request("/api/library/repeats/0123456789abcdef")).status).toBe(404);
    expect((await request("/api/library/repeats/not-an-id")).status).toBe(400);
  });
});

describe("POST /api/library/repeats/:id/promote", () => {
  it("starts the skill on it in plan mode, in the directory it was typed in", async () => {
    const { request, post, spawned, project } = setup();
    const id = await mergeId(request);
    const answer = await post(id, { target: "rule" });
    expect([answer.status, answer.body]).toEqual([200, { chatId: "new-session", agent: "claude" }]);
    expect(spawned).toEqual([["claude", project, `/mulmoterminal-library repeat rule ${id}`, true, null, { claudePermissionMode: "plan" }]]);
  });

  it("refuses another origin, a target that is not one, an id that is not one, and one that is gone", async () => {
    const refused = setup(false);
    expect((await refused.post(await mergeId(refused.request), { target: "rule" })).status).toBe(403);
    const { request, post, spawned } = setup();
    const id = await mergeId(request);
    expect((await post(id, { target: "memory" })).status).toBe(400);
    expect((await post("../../etc", { target: "rule" })).status).toBe(404);
    expect((await post("not-hex-at-all", { target: "rule" })).status).toBe(400);
    expect((await post("0123456789abcdef", { target: "skill" })).status).toBe(404);
    expect(spawned).toEqual([]);
  });

  it("starts in a directory past the ones the list names, when only that one is still here", async () => {
    const { request, post, spawned, root } = setup();
    const here = path.join(root, "still-here");
    mkdirSync(here);
    const gone = Array.from({ length: 12 }, (_, at) => path.join(root, `gone-${String(at)}`));
    const say = "あとで全部まとめて報告して";
    const sessionLines = (id: string, dir: string, times: number, at: number): string[] => [
      ...Array.from({ length: times }, (_, n) => JSON.stringify({ sessionId: id, display: say, project: dir, timestamp: NOW - at * 100 - n })),
      JSON.stringify({ sessionId: id, display: createHash("sha256").update(id).digest("hex"), project: dir, timestamp: NOW - at * 100 - 9 }),
    ];
    const lines = [...gone, here].flatMap((dir, at) => ["p", "q"].flatMap((session) => sessionLines(`${session}${String(at)}`, dir, dir === here ? 1 : 2, at)));
    writeFileSync(path.join(root, "history.jsonl"), `${lines.join("\n")}\n`);
    const list = await request("/api/library/repeats");
    const candidates: unknown = list.body.candidates;
    const found = Array.isArray(candidates) ? candidates.filter(isRepeatCandidate).find((c) => c.text === say) : undefined;
    if (found === undefined) throw new Error("expected the instruction to be a candidate");
    expect(found.projects).not.toContain(here);
    expect((await post(found.id, { target: "skill" })).status).toBe(200);
    expect(spawned.at(-1)?.[1]).toBe(here);
  });

  it("refuses when none of the directories it was typed in is on this machine", async () => {
    const { request, post, project, spawned } = setup();
    const id = await mergeId(request);
    rmSync(project, { recursive: true, force: true });
    expect((await post(id, { target: "skill" })).status).toBe(409);
    expect(spawned).toEqual([]);
  });
});
