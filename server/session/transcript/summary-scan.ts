// Building a session's summary from a stream of records instead of an array of them.
//
// `readSessionSummary` produced all seven fields in one pass over `parseJsonl(readFile(...))`,
// which is the pass that cannot run at all on a transcript past ~512 MB (#998). Each field was
// already a fold over the records — the only thing holding them together was the array.
//
// **No windows.** The first draft kept a tail of the last N records and read the "what happened
// recently" fields off it. That is wrong, and Codex caught the first instance: a turn has no
// bound — measured across the eight largest transcripts on this machine, the longest spans 3,615
// records — so a window silently drops a turn's early tool calls, then its prompt, then the reply
// and model that preceded a long run of tool results. Every field here therefore folds over every
// record, keeping only what it needs:
//
//   - counts and totals → running numbers
//   - "the newest X"    → the last X seen, replaced as it arrives
//   - the current turn  → reset on each user prompt (the rule already works that way)
//
// The state holds **no raw records**, which is what lets this fold be paused and RESUMED — kept
// beside the transcript and continued on what was appended rather than run again from the start
// (#1377 / #1386). It used to keep every user record, to pick the latest meaningful prompt out of
// them at the end, and the last assistant record, to read the model and context off it. Both are
// now resolved as they arrive, by the same functions that resolved them before — and both were
// unbounded: a transcript here holds 13,664 user records, and one of them can be megabytes.
//
// Every rule still lives in its `…FromParsed` function: each is fed a one-record or few-record
// window rather than reimplemented here.
import {
  aiTitleFromParsed,
  customTitleOfRecord,
  emptyPromptTrail,
  foldPromptTrail,
  foldTurnToolNames,
  latestAssistantTextFromParsed,
  latestTurnContextFromParsed,
  meaningfulPromptOf,
  sessionUsageFromParsed,
  turnOpeningPrompt,
  type PromptTrail,
} from "./transcript.js";
import { emptyTurnBoundary, type TurnBoundaryState } from "./turn-boundary.js";
import type { LatestTurnContext, SessionUsage } from "./transcript.js";
import { isRecord } from "../../../common/isRecord.js";

export interface SummaryParts {
  lastPrompt: string | null;
  customTitle: string | null;
  aiTitle: string | null;
  lastResponse: string | null;
  userTurns: number;
  usage: SessionUsage;
  context: LatestTurnContext;
  toolNames: string[];
}

/** Everything the summary needs to remember, and nothing that cannot be written down. */
export interface SummaryState {
  usage: SessionUsage;
  userTurns: number;
  aiTitle: string | null;
  /** What `/rename` last set; an empty rename clears it. */
  customTitle: string | null;
  prompts: PromptTrail;
  /** Whatever produced text most recently, so a long run of tool calls afterwards cannot bury it. */
  lastAssistantText: string | null;
  /** Model and context tokens off the last assistant MESSAGE, read as a unit — so a turn naming no
   *  model reports null rather than an earlier turn's model (Codex). */
  context: LatestTurnContext;
  /** Tool names in the current turn, emptied by each new user prompt. */
  turnTools: string[];
  /** Which turn is open, so text written into it is not read as the next prompt. */
  boundary: TurnBoundaryState;
}

export const emptySummaryState = (): SummaryState => ({
  usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 },
  userTurns: 0,
  aiTitle: null,
  customTitle: null,
  prompts: emptyPromptTrail(),
  lastAssistantText: null,
  context: { model: null, contextTokens: 0 },
  turnTools: [],
  boundary: emptyTurnBoundary(),
});

/** Every part of it, including the ones holding a collection: a resumed fold pushes into
 *  `turnTools` and adds into `usage`, and the state it continues from has already been read. */
export const copySummaryState = (state: SummaryState): SummaryState => ({
  usage: { ...state.usage },
  userTurns: state.userTurns,
  aiTitle: state.aiTitle,
  customTitle: state.customTitle,
  prompts: { ...state.prompts },
  lastAssistantText: state.lastAssistantText,
  context: { ...state.context },
  turnTools: [...state.turnTools],
  boundary: { ...state.boundary },
});

export function foldSummary(into: SummaryState, record: Record<string, unknown>): void {
  // One-record windows: each rule still decides for itself what counts, so "what is a user
  // turn" or "which usage fields exist" lives in one place, not two.
  const one = [record];
  // Taken once: it advances the boundary, so the three rules below must share the answer.
  const opening = turnOpeningPrompt(into.boundary, record);
  if (opening !== null) into.userTurns += 1;
  const perRecord = sessionUsageFromParsed(one);
  into.usage.inputTokens += perRecord.inputTokens;
  into.usage.outputTokens += perRecord.outputTokens;
  into.usage.cacheReadTokens += perRecord.cacheReadTokens;
  into.usage.cacheCreationTokens += perRecord.cacheCreationTokens;
  into.aiTitle = aiTitleFromParsed(one) ?? into.aiTitle;
  const renamed = customTitleOfRecord(record);
  if (renamed !== undefined) into.customTitle = renamed;
  foldTurnToolNames(into.turnTools, record, opening);
  foldPromptTrail(into.prompts, record, opening);
  // `?? previous` rather than an unconditional assign: an assistant record carrying only a
  // tool_use has no text, and must not blank out the reply the user is looking at.
  into.lastAssistantText = latestAssistantTextFromParsed(one) ?? into.lastAssistantText;
  // Resolved as it arrives rather than by keeping the record: the same one-record window, and its
  // ANSWER is two small fields where the record it came from can be megabytes.
  if (record.type === "assistant" && isRecord(record.message)) into.context = latestTurnContextFromParsed(one);
}

export const summaryPartsOf = (state: SummaryState, responseMax: number): SummaryParts => ({
  lastPrompt: meaningfulPromptOf(state.prompts),
  customTitle: state.customTitle,
  aiTitle: state.aiTitle,
  lastResponse: state.lastAssistantText?.slice(0, responseMax) ?? null,
  userTurns: state.userTurns,
  usage: state.usage,
  context: state.context,
  toolNames: state.turnTools,
});

export function createSummaryScan() {
  const state = emptySummaryState();
  return {
    add(record: Record<string, unknown>) {
      foldSummary(state, record);
    },
    finish: (responseMax: number): SummaryParts => summaryPartsOf(state, responseMax),
  };
}
