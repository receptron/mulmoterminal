// @vitest-environment node
//
// The copilot branch of sessionLastTurn and the push's copilotCurrentTurnReply, against a real
// COPILOT_HOME layout: the machine-global session store that binds an id to a directory, and the
// per-session event log the turn is read from.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { copilotCurrentTurnReply, sessionLastTurn } from "../../../server/session/session-reads.js";
import { EMPTY_TURN } from "../../../server/session/transcript/last-turn.js";

const HERE = "/work/project";
const ELSEWHERE = "/work/other";
const ID = "481d0525-eec8-4521-9cd3-ea8a71c871cd";

let home: string;
let priorHome: string | undefined;

const addSession = (id: string, cwd: string): void => {
  const db = new DatabaseSync(path.join(home, "session-store.db"));
  try {
    db.prepare("INSERT INTO sessions (id, cwd) VALUES (?, ?)").run(id, cwd);
  } finally {
    db.close();
  }
};

const writeEvents = (id: string, records: readonly object[]): void => {
  const dir = path.join(home, "session-state", id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "events.jsonl"), records.map((record) => JSON.stringify(record)).join("\n") + "\n");
};

const user = (content: string) => ({ type: "user.message", data: { content } });
const answer = (content: string) => ({ type: "assistant.message", data: { phase: "final_answer", content, toolRequests: [] } });

beforeEach(() => {
  home = mkdtempSync(path.join(tmpdir(), "mt-copilot-turn-"));
  priorHome = process.env.COPILOT_HOME;
  process.env.COPILOT_HOME = home;
  const db = new DatabaseSync(path.join(home, "session-store.db"));
  try {
    db.exec("CREATE TABLE sessions (id TEXT PRIMARY KEY, cwd TEXT)");
  } finally {
    db.close();
  }
});

afterEach(() => {
  if (priorHome === undefined) delete process.env.COPILOT_HOME;
  else process.env.COPILOT_HOME = priorHome;
  rmSync(home, { recursive: true, force: true });
});

describe("sessionLastTurn for copilot", () => {
  it("reads the last exchange from the session's event log", async () => {
    addSession(ID, HERE);
    writeEvents(ID, [user("first"), answer("one"), user("second"), answer("two")]);
    expect(await sessionLastTurn(HERE, ID, "copilot")).toEqual({ prompt: "second", reply: "two" });
  });

  it("refuses a session recorded under another directory", async () => {
    addSession(ID, ELSEWHERE);
    writeEvents(ID, [user("q"), answer("a")]);
    expect(await sessionLastTurn(HERE, ID, "copilot")).toEqual(EMPTY_TURN);
  });

  it("refuses an id with no session row, even when an event log exists under it", async () => {
    writeEvents(ID, [user("q"), answer("a")]);
    expect(await sessionLastTurn(HERE, ID, "copilot")).toEqual(EMPTY_TURN);
  });

  it("answers EMPTY_TURN for a session that has not written its event log yet", async () => {
    addSession(ID, HERE);
    expect(await sessionLastTurn(HERE, ID, "copilot")).toEqual(EMPTY_TURN);
  });
});

describe("copilotCurrentTurnReply", () => {
  it("answers the newest turn's reply", async () => {
    addSession(ID, HERE);
    writeEvents(ID, [user("q"), answer("a")]);
    expect(await copilotCurrentTurnReply(HERE, ID)).toBe("a");
  });

  it("answers null while the newest prompt is unanswered, not the older reply", async () => {
    addSession(ID, HERE);
    writeEvents(ID, [user("first"), answer("one"), user("second")]);
    expect(await copilotCurrentTurnReply(HERE, ID)).toBeNull();
  });

  it("refuses a session recorded under another directory", async () => {
    addSession(ID, ELSEWHERE);
    writeEvents(ID, [user("q"), answer("a")]);
    expect(await copilotCurrentTurnReply(HERE, ID)).toBeNull();
  });
});
