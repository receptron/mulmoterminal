// @vitest-environment node
//
// The phone's session list reads a claude row's prompt and name off the transcript. After a `/clear`
// or an in-session `/resume` the cell is in the successor's conversation, so that is the transcript
// it must read — never the frozen one under the session's own id (#3347).
import { describe, it, expect, afterAll, vi } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import { takeScratchHome } from "../../../support/scratchHome.js";
import { fakePtyEntry } from "../../../helpers/fakePtyEntry.js";

const SESSION = "5f2b3c74-ae63-4d99-9b2c-43558e2cb09d";
const SUCCESSOR = "6a3c4d85-bf74-4eaa-8c3d-54669f3dc1ae";

// Before the imports: the registry and the transcript paths are derived from HOME at import time.
const scratchHome = takeScratchHome("mt-host-list-moved-");
const CWD = path.join(scratchHome.path, "a-project");

vi.mock("../../../../server/infra/process/tmux.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../server/infra/process/tmux.js")>()),
  tmuxListSessionIds: () => [],
}));
vi.mock("../../../../server/backends/remoteHost/workByCwd.js", () => ({ workByCwd: async () => new Map() }));
vi.mock("../../../../server/session/list/session-lookup.js", () => ({ cwdOfSession: () => CWD, agentOfSession: () => "claude" }));
vi.mock("../../../../server/session/list/resumable-sessions.js", () => ({ resumableSessionPredicate: async () => () => true }));
vi.mock("../../../../server/session/registry.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../server/session/registry.js")>()),
  isPhoneListableSession: () => true,
}));

const { listTerminalSessions } = await import("../../../../server/backends/remoteHost/hostSessionList.js");
const { ptys, lastPrompts } = await import("../../../../server/session/registry.js");
const { projectSessionsDir } = await import("../../../../server/session/project-dir.js");
const { forgetClearedTranscript, markTranscriptCleared } = await import("../../../../server/session/transcript/cleared-transcripts.js");

afterAll(() => scratchHome.release());

async function writeTranscript(id: string, prompt: string): Promise<void> {
  const dir = projectSessionsDir(CWD);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, `${id}.jsonl`), `${JSON.stringify({ type: "user", message: { role: "user", content: prompt } })}\n`);
}

describe("listTerminalSessions for a claude session that moved", () => {
  it("reads the row's prompt from the successor's transcript", async () => {
    await writeTranscript(SESSION, "the conversation the cell left");
    await writeTranscript(SUCCESSOR, "the picked conversation");
    ptys.set(SESSION, fakePtyEntry({ cwd: CWD }));
    lastPrompts.delete(SESSION);
    await markTranscriptCleared(SESSION, undefined, SUCCESSOR);
    try {
      const listing = JSON.stringify(await listTerminalSessions());
      expect(listing).toContain("the picked conversation");
      expect(listing).not.toContain("the conversation the cell left");
    } finally {
      await forgetClearedTranscript(SESSION, path.join(scratchHome.path, "marks-unused"));
      ptys.delete(SESSION);
    }
  });
});
