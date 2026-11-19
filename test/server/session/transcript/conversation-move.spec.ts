// @vitest-environment node
import { describe, it, expect } from "vitest";
import { conversationMove, type ConversationMoveInput } from "../../../../server/session/transcript/conversation-move.js";

const OWN = "11111111-2222-4333-8444-555555555555";
const SUCCESSOR = "22222222-3333-4444-8555-666666666666";
const PICKED = "33333333-4444-4555-8666-777777777777";

const input = (over: Partial<ConversationMoveInput> = {}): ConversationMoveInput => ({
  source: "resume",
  sessionId: OWN,
  claudeId: PICKED,
  recordedSuccessor: undefined,
  marked: false,
  ...over,
});

describe("conversationMove", () => {
  describe("/clear", () => {
    it.each([
      ["no mark", input({ source: "clear", claudeId: PICKED })],
      ["already marked", input({ source: "clear", claudeId: PICKED, marked: true, recordedSuccessor: SUCCESSOR })],
      // A hook that named no id still froze our transcript.
      ["no id in the hook", input({ source: "clear", claudeId: null })],
      // Even the recorded successor: a second /clear leaves that conversation too.
      ["the recorded successor", input({ source: "clear", claudeId: SUCCESSOR, marked: true, recordedSuccessor: SUCCESSOR })],
      ["our own id", input({ source: "clear", claudeId: OWN })],
    ])("marks (%s)", (_label, given) => {
      expect(conversationMove(given)).toBe("mark");
    });
  });

  describe("/resume", () => {
    it("marks when claude moved to another conversation", () => {
      expect(conversationMove(input())).toBe("mark");
    });

    it("re-marks when it moves on from the recorded successor to a third conversation", () => {
      expect(conversationMove(input({ claudeId: PICKED, marked: true, recordedSuccessor: SUCCESSOR }))).toBe("mark");
    });

    // Our own `--resume <successor>` announces itself this way after every restart.
    it("leaves the mark alone when claude is on the recorded successor", () => {
      expect(conversationMove(input({ claudeId: SUCCESSOR, marked: true, recordedSuccessor: SUCCESSOR }))).toBe("none");
    });

    it("unmarks when claude came back to our own transcript", () => {
      expect(conversationMove(input({ claudeId: OWN, marked: true, recordedSuccessor: SUCCESSOR }))).toBe("unmark");
    });

    // An ordinary `--resume <own id>` of a session that was never moved.
    it("does nothing on our own id when there is no mark", () => {
      expect(conversationMove(input({ claudeId: OWN, marked: false }))).toBe("none");
    });

    it("does nothing when the hook named no usable id", () => {
      expect(conversationMove(input({ claudeId: null }))).toBe("none");
      expect(conversationMove(input({ claudeId: null, marked: true, recordedSuccessor: SUCCESSOR }))).toBe("none");
    });

    it("does nothing for an empty id", () => {
      expect(conversationMove(input({ claudeId: "" }))).toBe("none");
    });
  });

  // `/compact` keeps both the id and the file; anything else is not a move we know of.
  it.each([["compact"], ["startup"], [undefined], [null], [""], ["CLEAR"], ["Resume"], [42], [{ source: "clear" }], [["clear"]]])(
    "does nothing on source %j",
    (source) => {
      expect(conversationMove(input({ source }))).toBe("none");
      expect(conversationMove(input({ source, marked: true, recordedSuccessor: SUCCESSOR, claudeId: OWN }))).toBe("none");
    },
  );
});
