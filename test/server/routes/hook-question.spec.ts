// @vitest-environment node
// The question pane's feed (#1679): the hook that already reports every tool call is what tells the
// browser a dialog is up, and what tells it the dialog closed.
//
// Both halves are pinned because the SECOND one is what keeps the pane safe. Without the close, the
// buttons stay live over a prompt, where the keys they send walk the input history and Enter
// re-submits whatever they landed on.
import { describe, it, expect, beforeEach, vi } from "vitest";
import express from "express";
import request from "supertest";
import { mountHookRoute } from "../../../server/routes/hook-routes";
import { noteOtherWrite, otherWriteCount } from "../../../server/session/write-to-session";

vi.mock("../../../server/session/session-reads.js", () => ({ latestUserPrompt: vi.fn(async () => null) }));

const ID = "11111111-2222-4333-8444-555555555556";

const deps = {
  setWorking: vi.fn(),
  setWaiting: vi.fn(),
  publishActivity: vi.fn(),
  forgetTitle: vi.fn(),
  noteTitleTurn: vi.fn(),
  noteWorkPhase: vi.fn(),
  maybeGenerateTitle: vi.fn(async () => {}),
  recordToolCallStart: vi.fn(async () => {}),
  recordToolCallEnd: vi.fn(async () => {}),
  publishDirConfig: vi.fn(),
  publishFileWrite: vi.fn(),
  publishPromptSubmitted: vi.fn(),
  publishQuestion: vi.fn(),
  uiPort: "34567",
};

const app = express();
app.use(express.json());
mountHookRoute(app, deps);

const postHook = (body: Record<string, unknown>) => request(app).post("/api/hook").set("x-mt-session", ID).send(body);

// The shape a real PreToolUse carries, captured from claude 2.1.231.
const QUESTIONS = [
  {
    question: "Red or blue?",
    header: "Color",
    options: [
      { label: "Red", description: "Pick red." },
      { label: "Blue", description: "Pick blue." },
    ],
    multiSelect: false,
  },
];

beforeEach(() => vi.clearAllMocks());

describe("AskUserQuestion hooks", () => {
  it("offers the choices when the dialog opens", async () => {
    await postHook({ hook_event_name: "PreToolUse", tool_name: "AskUserQuestion", tool_use_id: "toolu_1", tool_input: { questions: QUESTIONS } });

    expect(deps.publishQuestion).toHaveBeenCalledWith({ sessionId: ID, toolUseId: "toolu_1", questions: QUESTIONS });
  });

  it("says the dialog closed when the tool completes", async () => {
    await postHook({ hook_event_name: "PostToolUse", tool_name: "AskUserQuestion", tool_use_id: "toolu_1", tool_input: { questions: QUESTIONS } });

    expect(deps.publishQuestion).toHaveBeenCalledWith({ sessionId: ID, toolUseId: "toolu_1", done: true });
  });

  // Esc is a failure, not a completion — and it leaves no dialog on screen either.
  it("says the dialog closed when the tool fails", async () => {
    await postHook({ hook_event_name: "PostToolUseFailure", tool_name: "AskUserQuestion", tool_use_id: "toolu_1", tool_input: { questions: QUESTIONS } });

    expect(deps.publishQuestion).toHaveBeenCalledWith({ sessionId: ID, toolUseId: "toolu_1", done: true });
  });

  // The count that tells an answer "this dialog has been typed into" starts HERE, when the dialog
  // appears — not when an answer request arrives, which could never see a keystroke that preceded it.
  it("starts counting other input from the moment the dialog appears", async () => {
    noteOtherWrite(ID); // typed before this dialog existed
    await postHook({ hook_event_name: "PreToolUse", tool_name: "AskUserQuestion", tool_use_id: "toolu_1", tool_input: { questions: QUESTIONS } });

    expect(otherWriteCount(ID)).toBe(0); // the earlier keystroke is not this dialog's business

    noteOtherWrite(ID); // and this one is
    expect(otherWriteCount(ID)).toBe(1);
  });

  it("ignores every other tool", async () => {
    await postHook({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_use_id: "toolu_2", tool_input: { command: "ls" } });
    await postHook({ hook_event_name: "PostToolUse", tool_name: "Bash", tool_use_id: "toolu_2", tool_input: { command: "ls" } });

    expect(deps.publishQuestion).not.toHaveBeenCalled();
    // The history still gets both, which is the pre-existing behaviour this rides on.
    expect(deps.recordToolCallStart).toHaveBeenCalledTimes(1);
    expect(deps.recordToolCallEnd).toHaveBeenCalledTimes(1);
  });

  // A dialog we could not read whole must not reach the pane: answering happens by INDEX, and a
  // half-read option list would aim the keystrokes at the wrong row.
  it("stays quiet when the questions do not parse", async () => {
    await postHook({ hook_event_name: "PreToolUse", tool_name: "AskUserQuestion", tool_use_id: "toolu_3", tool_input: { questions: "nope" } });

    expect(deps.publishQuestion).not.toHaveBeenCalled();
  });
});
