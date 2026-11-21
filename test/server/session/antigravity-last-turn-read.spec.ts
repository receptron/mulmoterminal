// @vitest-environment node
//
// The Antigravity branch of sessionLastTurn and the push's antigravityCurrentTurnReply, against a
// real ANTIGRAVITY_HOME layout. The key here names no recorded mapping, so it is read as the
// conversation id itself — the path a session picked from the conversation list takes.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { antigravityCurrentTurnReply, sessionLastTurn } from "../../../server/session/session-reads.js";
import { EMPTY_TURN } from "../../../server/session/transcript/last-turn.js";

const ID = "77099efc-d0f0-4b6f-98cc-9a9ca4e9b50c";

let home: string;
let priorHome: string | undefined;

const writeSteps = (id: string, steps: readonly object[]): void => {
  const dir = path.join(home, "brain", id, ".system_generated", "logs");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "transcript.jsonl"), steps.map((step) => JSON.stringify(step)).join("\n") + "\n");
};

const user = (text: string) => ({ type: "USER_INPUT", status: "DONE", content: `<USER_REQUEST>\n${text}\n</USER_REQUEST>` });
const answer = (content: string) => ({ type: "PLANNER_RESPONSE", status: "DONE", content });

beforeEach(() => {
  home = mkdtempSync(path.join(tmpdir(), "mt-agy-turn-"));
  priorHome = process.env.ANTIGRAVITY_HOME;
  process.env.ANTIGRAVITY_HOME = home;
});

afterEach(() => {
  if (priorHome === undefined) delete process.env.ANTIGRAVITY_HOME;
  else process.env.ANTIGRAVITY_HOME = priorHome;
  rmSync(home, { recursive: true, force: true });
});

describe("sessionLastTurn for antigravity", () => {
  it("reads the last exchange from the conversation's transcript", async () => {
    writeSteps(ID, [user("first"), answer("one"), user("second"), answer("two")]);
    expect(await sessionLastTurn("/work/project", ID, "antigravity")).toEqual({ prompt: "second", reply: "two" });
  });

  it("answers EMPTY_TURN for a conversation with no transcript", async () => {
    expect(await sessionLastTurn("/work/project", ID, "antigravity")).toEqual(EMPTY_TURN);
  });
});

describe("antigravityCurrentTurnReply", () => {
  it("answers the newest turn's reply", async () => {
    writeSteps(ID, [user("q"), answer("a")]);
    expect(await antigravityCurrentTurnReply(ID)).toBe("a");
  });

  it("answers null while the newest prompt is unanswered, not the older reply", async () => {
    writeSteps(ID, [user("first"), answer("one"), user("second")]);
    expect(await antigravityCurrentTurnReply(ID)).toBeNull();
  });
});
