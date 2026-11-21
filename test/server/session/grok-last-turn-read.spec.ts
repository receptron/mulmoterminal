// @vitest-environment node
//
// The grok branch of sessionLastTurn, against a real GROK_HOME layout: conversations partitioned by
// the encoded cwd, so the directory a request names is the one read.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { sessionLastTurn } from "../../../server/session/session-reads.js";
import { EMPTY_TURN } from "../../../server/session/transcript/last-turn.js";

const HERE = "/work/project";
const ELSEWHERE = "/work/other";
const ID = "e0977d25-42a5-41d3-b442-ee4de92b7163";

let home: string;
let priorHome: string | undefined;

const writeHistory = (cwd: string, id: string, records: readonly object[]): void => {
  const dir = path.join(home, "sessions", encodeURIComponent(cwd), id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "chat_history.jsonl"), records.map((record) => JSON.stringify(record)).join("\n") + "\n");
};

const user = (text: string, index: number) => ({
  type: "user",
  content: [{ type: "text", text: `<user_query>\n${text}\n</user_query>` }],
  prompt_index: index,
});
const answer = (content: string) => ({ type: "assistant", content });

beforeEach(() => {
  home = mkdtempSync(path.join(tmpdir(), "mt-grok-turn-"));
  priorHome = process.env.GROK_HOME;
  process.env.GROK_HOME = home;
});

afterEach(() => {
  if (priorHome === undefined) delete process.env.GROK_HOME;
  else process.env.GROK_HOME = priorHome;
  rmSync(home, { recursive: true, force: true });
});

describe("sessionLastTurn for grok", () => {
  it("reads the last exchange from the conversation under this cwd", async () => {
    writeHistory(HERE, ID, [user("first", 0), answer("one"), user("second", 1), answer("two")]);
    expect(await sessionLastTurn(HERE, ID, "grok")).toEqual({ prompt: "second", reply: "two" });
  });

  it("does not read a conversation recorded under another directory", async () => {
    writeHistory(ELSEWHERE, ID, [user("q", 0), answer("a")]);
    expect(await sessionLastTurn(HERE, ID, "grok")).toEqual(EMPTY_TURN);
  });

  it("refuses an id that is not a conversation id, without touching the filesystem", async () => {
    writeHistory(HERE, ID, [user("q", 0), answer("a")]);
    expect(await sessionLastTurn(HERE, `../${encodeURIComponent(HERE)}/${ID}`, "grok")).toEqual(EMPTY_TURN);
  });

  it("answers EMPTY_TURN for a conversation that has written nothing yet", async () => {
    expect(await sessionLastTurn(HERE, ID, "grok")).toEqual(EMPTY_TURN);
  });
});
