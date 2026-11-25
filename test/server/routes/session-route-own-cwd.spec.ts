// @vitest-environment node
//
// WHICH DIRECTORY a route that is ABOUT one session answers about, when the request names none
// (#2133).
//
// `?cwd=` was optional and defaulted to the workspace, which is right for a route reporting on a
// DIRECTORY and wrong for every route reporting on a SESSION: a session runs where it runs, and
// most of the stores these routes read are partitioned by directory — claude's transcript sits
// under a slug derived from the cwd, and grok's, cursor's, copilot's and muse's are scoped by it
// too. So a caller that sent no `cwd` was answered out of a different project's files.
//
// The caller that does exactly that is the collection chat pane (`useSessionSummary.ts`): it knows
// the session and its agent and has no directory to send — the chat is filed under a collection,
// not under a path — so its supervision line was read from the workspace and came back blank.
//
// The decoy is what makes this a measurement rather than a smoke test: the SAME session id has a
// transcript under both directories, with different words in it. Before the fix a no-cwd request
// answered with the decoy's; a test whose workspace held nothing could not tell "read the right
// file" from "read no file".
//
// One agent is enough here even though seven are hosted: the directory is resolved once, before
// any agent branch, so this pins the resolution and `session-detail-agent.spec.ts` pins the
// branch. Claude is the sharpest of them — its transcript PATH is derived from the cwd.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import express from "express";
import { routeCall } from "../../helpers/routeCall";
import { takeScratchHome } from "../../support/scratchHome.js";

const SESSION = "3d0f1a52-8c41-4b77-9f0e-21336c0a9e7b";

// HOME moves BEFORE the imports: CLAUDE_CWD and MULMOTERMINAL_HOME are both computed from it at
// import time, and the remembered-cwd map is hydrated from a file under the second one. Writing
// that file first is what lets this spec use the real hydration path instead of reaching into the
// registry — and it means nothing is ever appended to the developer's own ~/.mulmoterminal.
const scratchHome = takeScratchHome("mt-session-own-cwd-");
// A shell in a MulmoTerminal cell inherits the server's CLAUDE_CWD, which env.ts prefers over HOME.
const REAL_CLAUDE_CWD = process.env.CLAUDE_CWD;
delete process.env.CLAUDE_CWD;
const OWN_CWD = path.join(scratchHome.path, "a-project");
const WORKSPACE = path.join(scratchHome.path, "mulmoclaude");
await fs.mkdir(path.join(scratchHome.path, ".mulmoterminal"), { recursive: true });
await fs.writeFile(path.join(scratchHome.path, ".mulmoterminal", "dev-terminal-cwds.json"), `${SESSION} ${OWN_CWD}\n`);

const { mountSessionRoutes } = await import("../../../server/routes/session-routes.js");
const { projectSessionsDir } = await import("../../../server/session/project-dir.js");
const { CLAUDE_CWD } = await import("../../../server/config/env.js");
const { lastPrompts, lastResponses } = await import("../../../server/session/registry.js");
const { forgetClearedTranscript, markTranscriptCleared } = await import("../../../server/session/transcript/cleared-transcripts.js");

afterAll(() => {
  if (REAL_CLAUDE_CWD !== undefined) process.env.CLAUDE_CWD = REAL_CLAUDE_CWD;
  scratchHome.release();
});

const app = express();
mountSessionRoutes(app, { freshenRosterTitle: () => {}, publishActivity: () => {}, agentOfSession: () => null });
const call = routeCall(app);

const line = (record: unknown): string => `${JSON.stringify(record)}\n`;

/** A claude transcript for SESSION under `cwd`, with `marker` in its prompt, its tool call and its
 *  reply — so one assertion serves every route, whichever of the three each of them reads. */
async function writeTranscript(cwd: string, marker: string, id: string = SESSION): Promise<void> {
  const dir = projectSessionsDir(cwd);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, `${id}.jsonl`),
    line({ type: "user", message: { role: "user", content: `asked in ${marker}` } }) +
      line({
        type: "assistant",
        message: { role: "assistant", content: [{ type: "tool_use", name: "Edit", input: { file_path: `${marker}.ts` } }], stop_reason: "tool_use" },
      }) +
      line({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: `answered in ${marker}` }], stop_reason: "end_turn" } }),
  );
}

beforeAll(async () => {
  await fs.mkdir(OWN_CWD, { recursive: true });
  await fs.mkdir(WORKSPACE, { recursive: true });
  await writeTranscript(OWN_CWD, "own-directory");
  await writeTranscript(WORKSPACE, "workspace-decoy");
  // The live maps outrank the disk read and are process-wide; a value another spec left behind
  // would answer these assertions without any file being opened.
  lastPrompts.delete(SESSION);
  lastResponses.delete(SESSION);
});

// Every route that is about ONE session, by the query shape each of them takes. #2122's lesson is
// why the list is exhaustive rather than exemplary: that fix corrected one of three sites reading
// the wrong file and left the other two, and a defect in a shared decision comes back through
// whichever caller was not swept.
const SESSION_ROUTES = [
  `/api/session/${SESSION}`,
  `/api/transcript/timeline?session=${SESSION}`,
  `/api/transcript/prompts?session=${SESSION}`,
  `/api/transcript/last-turn?session=${SESSION}`,
  `/api/transcript/view?session=${SESSION}`,
] as const;

describe("a route about one session, asked with no ?cwd=", () => {
  it.each(SESSION_ROUTES)("answers %s out of the session's own directory", async (url) => {
    const res = await call(url);
    expect(res.status).toBe(200);
    expect(res.text).toContain("own-directory");
    expect(res.text).not.toContain("workspace-decoy");
  });

  // The control: the decoy IS readable, so the assertion above fails because the wrong directory
  // was read — not because the workspace happened to hold nothing.
  it.each(SESSION_ROUTES)("still answers %s about an explicitly requested directory", async (url) => {
    const res = await call(`${url}${url.includes("?") ? "&" : "?"}${new URLSearchParams({ cwd: WORKSPACE })}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain("workspace-decoy");
    expect(res.text).not.toContain("own-directory");
  });
});

// The same routes after a `/clear` or an in-session `/resume`: the cell is in the successor's
// conversation, and each route must read that transcript rather than the frozen one under our id
// (#3347). Exhaustive for the same reason as above.
describe("a route about one session that moved to another transcript", () => {
  const SUCCESSOR = "4e1a2b63-9d52-4c88-8a1b-32447d1baf8c";

  beforeAll(async () => {
    await writeTranscript(OWN_CWD, "successor-conversation", SUCCESSOR);
    await markTranscriptCleared(SESSION, undefined, SUCCESSOR);
  });
  afterAll(async () => {
    await forgetClearedTranscript(SESSION, path.join(scratchHome.path, "marks-unused"));
  });

  it.each(SESSION_ROUTES)("answers %s out of the successor's transcript", async (url) => {
    const res = await call(url);
    expect(res.status).toBe(200);
    expect(res.text).toContain("successor-conversation");
    expect(res.text).not.toContain("own-directory");
  });
});

describe("a route about a DIRECTORY, asked with no ?cwd=", () => {
  // The other half of the change: a list route reports on a project, so its default must stay the
  // workspace. Redirecting those to a session's directory would be the same bug pointing the other
  // way — the grid's resume picker would list whatever the last session ran in.
  it("keeps the workspace", async () => {
    expect(CLAUDE_CWD).toBe(WORKSPACE); // the scratch home really is what the routes resolved against
    const res = await call("/api/sessions");
    expect(res.status).toBe(200);
    expect(res.body.cwd).toBe(WORKSPACE);
  });
});
