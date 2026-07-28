import { describe, it, expect } from "vitest";
import type { DecisionQuestion, DecisionRecord } from "../../../common/decisionLog";
import { answerKindText, decisionRows, emptyStateText, filterRows, isChosen, kindCounts, unreadableNote } from "../../../src/components/decisionRows";

const question = (over: Partial<DecisionQuestion> = {}): DecisionQuestion => ({
  question: "どう進めますか？",
  header: "進め方",
  multiSelect: false,
  options: [
    { label: "今すぐ実装する", description: "ブランチを切って着手" },
    { label: "後で", description: "他を先に" },
  ],
  answer: "今すぐ実装する",
  answerKind: "option",
  ...over,
});

const record = (over: Partial<DecisionRecord> = {}): DecisionRecord => ({
  sessionId: "sesn-1",
  cwd: "/home/dev/p",
  ts: "2026-07-28T01:00:00Z",
  toolUseId: "toolu_1",
  questions: [question()],
  ...over,
});

describe("decisionRows", () => {
  it("makes one row per question, not per call — a call can ask unrelated things", () => {
    const rows = decisionRows([record({ questions: [question(), question({ question: "いつ？", header: "時期" })] })]);
    expect(rows.map((r) => r.question.header)).toEqual(["進め方", "時期"]);
    expect(rows.map((r) => r.key)).toEqual(["toolu_1:0", "toolu_1:1"]);
    expect(rows.every((r) => r.ts === "2026-07-28T01:00:00Z" && r.sessionId === "sesn-1")).toBe(true);
  });

  it("keeps the records' order and yields nothing for an empty answer", () => {
    expect(decisionRows([])).toEqual([]);
    expect(decisionRows([record({ questions: [] })])).toEqual([]);
  });
});

describe("filterRows / kindCounts", () => {
  const rows = decisionRows([
    record({ toolUseId: "a", questions: [question()] }),
    record({ toolUseId: "b", questions: [question({ answerKind: "free-text", answer: "そうじゃなくて…" })] }),
    record({ toolUseId: "c", questions: [question({ answerKind: "unanswered", answer: null })] }),
  ]);

  it("counts each kind", () => {
    expect(kindCounts(rows)).toEqual({ option: 1, "free-text": 1, unanswered: 1 });
  });

  it("filters to one kind, and `all` keeps everything", () => {
    expect(filterRows(rows, "all")).toHaveLength(3);
    expect(filterRows(rows, "free-text").map((r) => r.question.answer)).toEqual(["そうじゃなくて…"]);
    expect(filterRows(rows, "unanswered")).toHaveLength(1);
  });
});

describe("isChosen", () => {
  it("marks the option that was picked, and only it", () => {
    const q = question();
    expect(isChosen(q, "今すぐ実装する")).toBe(true);
    expect(isChosen(q, "後で")).toBe(false);
  });

  it("marks every option of a multi-select answer, including labels that contain a comma", () => {
    const q = question({
      multiSelect: true,
      options: [
        { label: "A, 全体", description: "" },
        { label: "B", description: "" },
        { label: "C", description: "" },
      ],
      answer: "A, 全体, B",
    });
    expect([isChosen(q, "A, 全体"), isChosen(q, "B"), isChosen(q, "C")]).toEqual([true, true, false]);
  });

  it("marks nothing when the user wrote their own answer, even if it repeats a label", () => {
    // The answer text is not a choice here — treating it as one would show a decision that
    // wasn't made.
    const q = question({ answerKind: "free-text", answer: "今すぐ実装する でもその前に相談したい" });
    expect(isChosen(q, "今すぐ実装する")).toBe(false);
  });

  it("marks nothing for an unanswered question", () => {
    expect(isChosen(question({ answerKind: "unanswered", answer: null }), "今すぐ実装する")).toBe(false);
  });
});

describe("what the screen says when there is nothing to show", () => {
  it("tells the three empty cases apart", () => {
    expect(emptyStateText(0, 0)).toBe("No sessions in this project yet.");
    expect(emptyStateText(0, 3)).toBe("No transcripts could be read (3 unreadable).");
    expect(emptyStateText(12, 0)).toBe("Nothing was asked in this project's 12 sessions.");
  });

  it("warns about an incomplete scan alongside results, and says nothing when complete", () => {
    expect(unreadableNote(0)).toBeNull();
    expect(unreadableNote(1)).toBe("1 transcript could not be read — decisions may be missing.");
    expect(unreadableNote(4)).toContain("4 transcripts");
  });

  it("names each answer kind in the reader's terms", () => {
    expect(answerKindText("option")).toBe("chose an option");
    expect(answerKindText("free-text")).toBe("wrote their own answer");
    expect(answerKindText("unanswered")).toBe("never answered");
  });
});
