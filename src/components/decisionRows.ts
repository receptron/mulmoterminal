// What the decision log shows, decided outside the component so the rules are testable without
// mounting anything (#1008).
//
// One row per QUESTION, not per AskUserQuestion call: a single call can ask several unrelated
// things, and the one filter that matters — "show me the ones where the options were wrong" —
// applies to a question, not to the call it arrived in.
import type { DecisionAnswerKind, DecisionQuestion, DecisionRecord } from "../../common/decisionLog";

export interface DecisionRow {
  /** Stable across re-fetches: the ask's tool_use id plus the question's place in it. */
  key: string;
  ts: string;
  sessionId: string;
  question: DecisionQuestion;
}

export type DecisionFilter = "all" | DecisionAnswerKind;

export const decisionRows = (records: DecisionRecord[]): DecisionRow[] =>
  records.flatMap((record) =>
    record.questions.map((question, i) => ({ key: `${record.toolUseId}:${i}`, ts: record.ts, sessionId: record.sessionId, question })),
  );

export const filterRows = (rows: DecisionRow[], filter: DecisionFilter): DecisionRow[] =>
  filter === "all" ? rows : rows.filter((row) => row.question.answerKind === filter);

export type KindCounts = Record<DecisionAnswerKind, number>;

export function kindCounts(rows: DecisionRow[]): KindCounts {
  const counts: KindCounts = { option: 0, "free-text": 0, unanswered: 0 };
  for (const row of rows) counts[row.question.answerKind]++;
  return counts;
}

// Which of the offered options the answer actually picked, so the chosen one can be marked and the
// rest read as what was turned down. A multi-select answer is the chosen labels joined by ", ",
// and a label may contain ", " itself — so membership is tested against the joined string's
// boundaries rather than by splitting it.
export function isChosen(question: DecisionQuestion, label: string): boolean {
  const answer = question.answer;
  if (answer === null || question.answerKind !== "option") return false;
  if (answer === label) return true;
  const SEP = ", ";
  return answer.startsWith(`${label}${SEP}`) || answer.endsWith(`${SEP}${label}`) || answer.includes(`${SEP}${label}${SEP}`);
}

// Said in the UI's own words rather than the wire's: `free-text` is not a data type to a reader,
// it is the day the question missed.
const KIND_TEXT: Record<DecisionAnswerKind, string> = {
  option: "chose an option",
  "free-text": "wrote their own answer",
  unanswered: "never answered",
};

export const answerKindText = (kind: DecisionAnswerKind): string => KIND_TEXT[kind];

/** What an empty result means — the three cases are different facts, not one blank screen. */
export function emptyStateText(scanned: number, unreadable: number): string {
  if (unreadable > 0 && scanned === 0) return `No transcripts could be read (${unreadable} unreadable).`;
  if (scanned === 0) return "No sessions in this project yet.";
  return `Nothing was asked in this project's ${scanned} sessions.`;
}

/** Shown alongside results, not instead of them: a partial scan must not read as a quiet project. */
export function unreadableNote(unreadable: number): string | null {
  if (unreadable === 0) return null;
  const noun = unreadable === 1 ? "transcript" : "transcripts";
  return `${unreadable} ${noun} could not be read — decisions may be missing.`;
}
