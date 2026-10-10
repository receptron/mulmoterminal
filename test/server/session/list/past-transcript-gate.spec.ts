import { describe, it, expect } from "vitest";
import { gatedPastTranscriptPage, type PastTranscriptStores } from "../../../../server/session/list/past-transcript-gate";
import type { PastSessionRow } from "../../../../server/session/list/past-session-rows";

const CWD = "/work/app";
const READABLE: PastSessionRow = { id: "aaaaaaaa-0000-4000-8000-000000000001", title: "claude", mtime: 2, agent: "claude", readable: true };
const UNREADABLE: PastSessionRow = { id: "aaaaaaaa-0000-4000-8000-000000000002", title: "grok", mtime: 1, agent: "grok", readable: false };
const LISTED: PastSessionRow[] = [READABLE, UNREADABLE];

function stores(rows: PastSessionRow[] = LISTED) {
  const reads: { cwd: string; id: string; before: string | null; agent: string }[] = [];
  const listed: string[] = [];
  const fake: PastTranscriptStores = {
    listPastSessions: async (cwd) => {
      listed.push(cwd);
      return rows;
    },
    readPage: async (cwd, id, before, agent) => {
      reads.push({ cwd, id, before, agent });
      return { view: { status: "none" }, older: null };
    },
    isCursor: (before) => /^claude:\d+$/.test(before),
  };
  return { fake, reads, listed };
}

describe("gatedPastTranscriptPage", () => {
  it("reads a listed, readable session in the open session's directory, as its own agent", async () => {
    const { fake, reads, listed } = stores();
    await gatedPastTranscriptPage(fake, CWD, READABLE.id, "claude:42");
    expect(listed).toEqual([CWD]);
    expect(reads).toEqual([{ cwd: CWD, id: READABLE.id, before: "claude:42", agent: "claude" }]);
  });

  it("refuses an id the directory's list does not hold, without reading anything", async () => {
    const { fake, reads } = stores();
    const elsewhere = "bbbbbbbb-0000-4000-8000-000000000009";
    await expect(gatedPastTranscriptPage(fake, CWD, elsewhere, null)).rejects.toThrow("not among this directory's past sessions");
    await expect(gatedPastTranscriptPage(fake, CWD, READABLE.id.slice(0, 20), null)).rejects.toThrow("not among");
    await expect(gatedPastTranscriptPage(fake, CWD, "../../etc/passwd", null)).rejects.toThrow("not among");
    await expect(gatedPastTranscriptPage(stores([]).fake, CWD, READABLE.id, null)).rejects.toThrow("not among");
    expect(reads).toEqual([]);
  });

  it("answers not-supported for a listed session no reader here reads, without reading", async () => {
    const { fake, reads } = stores();
    expect(await gatedPastTranscriptPage(fake, CWD, UNREADABLE.id, null)).toEqual({ view: { status: "not-supported" }, older: null });
    expect(reads).toEqual([]);
  });

  it("refuses a malformed cursor before listing or reading", async () => {
    const { fake, reads, listed } = stores();
    await expect(gatedPastTranscriptPage(fake, CWD, READABLE.id, "garbage")).rejects.toThrow("cursor");
    await expect(gatedPastTranscriptPage(fake, CWD, READABLE.id, "")).rejects.toThrow("cursor");
    expect(listed).toEqual([]);
    expect(reads).toEqual([]);
  });
});
