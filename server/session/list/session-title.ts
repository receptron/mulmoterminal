// The session's AI-generated title: when it is due, generating it without letting two
// triggers race, and voiding a result that a /clear made stale. Split from index.ts
// (#548 step 3f) — the rules for WHETHER to (re)generate already live in
// config/header/header-title.ts; this is the bookkeeping around them.
//
// Four guards do the real work and are easy to lose in a rewrite: an epoch that drops a
// title generated across a /clear, the cleared-transcript mark that stops the NEXT turn
// generating one from that same pre-clear file, an in-flight set so a Stop hook and a roster
// view do not both summarize, and a retry floor so a viewed-but-failing session is not
// re-summarized on every poll.
import { aiTitleFromParsed, conversationTurnsFromParsed, isTrivialPrompt, type ConversationTurn } from "../transcript/transcript.js";
import { forEachJsonlRecord } from "../../infra/fs/jsonl-file.js";
import {
  emptyTitleWindow,
  foldTitleWindow,
  shouldFreshenViewedTitle,
  shouldRegenerateTitle,
  titleNeedsTurns,
  titleWindowOf,
  TITLE_REGEN_EVERY_TURNS,
  VIEW_TITLE_REGEN_TURNS,
} from "../../config/header/header-title.js";
import { aiTitles, lastTitleAttemptMs, lastTitledUserTurns, titleEpoch, titleInFlight, titlePending, titleTurnCounts } from "../registry.js";
import { transcriptIdOf } from "../transcript/cleared-transcripts.js";
import { claudeTranscriptFile } from "../session-home.js";
import { readSessionSummary } from "../session-reads.js";

// How long a viewed session that failed to summarize waits before being tried again, so a
// roster poll cannot spawn a summarizer per request.
const VIEW_TITLE_RETRY_MS = 30_000;

export interface TitleDeps {
  /** Push the session's row (with its new title) to subscribers. */
  publishActivity: (id: string) => void;
  /** Injected so the retry floor can be tested without waiting out 30 seconds. */
  now: () => number;
  /** The session's title, from whichever source `header-title.ts` selects: the `ai-title` Claude
   *  Code wrote into its own transcript (the default — no process at all), or a summary of the
   *  turns. Injected because the second one shells out to the claude CLI, which a unit test must
   *  never do. */
  // Turns, not the raw transcript: the file reaches 585 MB here and cannot be held as a string
  // at all (#998). The title only reads the last few turns anyway.
  resolveTitle: (input: { turns: ConversationTurn[]; diskAiTitle: string | null }) => Promise<string | null>;
}

interface TitleInputs {
  /** Already narrowed to what a summary can use — see `foldTitleWindow`. */
  turns: ConversationTurn[];
  /** Counted, never derived from `turns`: that array holds at most the last few, and the roster's
   *  re-title cadence compares this against the transcript's CURRENT count (CodeRabbit on #1772).
   *  Deriving it would pin it at the window size and re-title on every poll forever. */
  userTurns: number;
  /** Whether the transcript held any turn at all — the gate the resolve is skipped on. */
  anyTurn: boolean;
  diskAiTitle: string | null;
  /** False when the file could not be opened at all, which is different from a transcript that
   *  simply has nothing to title. */
  read: boolean;
}

/** One streamed pass over the transcript, yielding everything the title needs: the window of turns
 *  (for the `headless` source), how many user turns there were (for the bookkeeping), and the
 *  `ai-title` Claude Code wrote (for the default source). Nothing here grows with the file: it is
 *  streamed because a transcript reaches 585 MB (#998), and retaining every parsed turn to pick six
 *  of them would have given that back. */
async function readTitleInputs(transcriptId: string, cwd: string): Promise<TitleInputs> {
  const window = emptyTitleWindow();
  let userTurns = 0;
  let anyTurn = false;
  let diskAiTitle: string | null = null;
  let read = true;
  await forEachJsonlRecord(claudeTranscriptFile(cwd, transcriptId), (record) => {
    conversationTurnsFromParsed([record]).forEach((turn) => {
      anyTurn = true;
      if (turn.role === "user") userTurns++;
      foldTitleWindow(window, turn);
    });
    // The LAST one wins, the same rule session-reads.ts folds by.
    diskAiTitle = aiTitleFromParsed([record]) ?? diskAiTitle;
  }).catch(() => (read = false));
  return { turns: titleWindowOf(window), userTurns, anyTurn, diskAiTitle, read };
}

/** Store a title the caller already holds — the default source's whole job. `readSessionSummary`
 *  folds `ai-title` out of the transcript incrementally and caches it beside the file
 *  (#1377/#1386), so the roster route has the answer in hand on every poll and there is nothing to
 *  scan for. A session that moved with nowhere recorded is skipped (#1085), and an
 *  unchanged title does not publish — the roster would otherwise redraw on every poll. */
function storeKnownTitle(sessionId: string, title: string | null, deps: TitleDeps): void {
  if (!title || transcriptIdOf(sessionId) === null || aiTitles.get(sessionId) === title) return;
  aiTitles.set(sessionId, title);
  titleTurnCounts.set(sessionId, 0);
  deps.publishActivity(sessionId);
}

/** The `headless` source: stream the transcript, summarize its recent turns, store + publish.
 *  Epoch-guarded, so a /clear or teardown mid-generation drops the now-stale result; in-flight
 *  guarded, so a Stop hook and a roster view do not both summarize. Never throws — a failed or
 *  timed-out CLI just leaves the prior title. */
async function summarizeAndStoreTitle(sessionId: string, transcriptId: string, cwd: string, deps: TitleDeps): Promise<void> {
  titleInFlight.add(sessionId);
  const epoch = titleEpoch.get(sessionId) ?? 0;
  try {
    const { turns, userTurns, anyTurn, diskAiTitle, read } = await readTitleInputs(transcriptId, cwd);
    const checked = read && anyTurn;
    const title = checked ? await deps.resolveTitle({ turns, diskAiTitle }) : null;
    if ((titleEpoch.get(sessionId) ?? 0) !== epoch) return;
    storeKnownTitle(sessionId, title, deps);
    // Advanced on any COMPLETED check, not only a successful one (Codex on #1772): null here means
    // the CLI failed, and leaving the mark unset made `shouldFreshenViewedTitle` stay true forever
    // — a full transcript scan every 30s for as long as the roster watched the session, over a file
    // that reaches 585 MB (#998). Advancing ties the retry to the CONVERSATION moving on instead of
    // to the clock. A file we could not read at all does not advance: nothing was established.
    if (checked) lastTitledUserTurns.set(sessionId, userTurns);
  } finally {
    titleInFlight.delete(sessionId);
  }
}

export function createTitleManager(deps: TitleDeps) {
  // Drop all AI-title bookkeeping for a session (on /clear or teardown). Bumping the epoch
  // voids any in-flight generation started before this reset — its (now pre-clear) title
  // must not resurface after the header was cleared.
  function forgetTitle(sessionId: string): void {
    aiTitles.delete(sessionId);
    titleTurnCounts.delete(sessionId);
    titlePending.delete(sessionId);
    // The baseline counted the turns of the conversation that was titled; the next one starts again.
    lastTitledUserTurns.delete(sessionId);
    titleEpoch.set(sessionId, (titleEpoch.get(sessionId) ?? 0) + 1);
  }

  // Count a user turn and flag the session for a title (re)generation at the next Stop when
  // one is due (no title yet, a trivial/stale-inducing ack, or every N turns).
  function noteTitleTurn(sessionId: string, prompt: string): void {
    const turnsSinceTitle = (titleTurnCounts.get(sessionId) ?? 0) + 1;
    titleTurnCounts.set(sessionId, turnsSinceTitle);
    const due = shouldRegenerateTitle({
      hasTitle: aiTitles.has(sessionId),
      promptIsTrivial: isTrivialPrompt(prompt),
      turnsSinceTitle,
      maxTurns: TITLE_REGEN_EVERY_TURNS,
    });
    if (due) titlePending.add(sessionId);
  }

  // Title the session, by whichever route its source needs, from the transcript the cell is in now.
  // Never from ours once claude has moved off it: that file is frozen on the conversation the user
  // left, and this is where its title kept coming back (#1085). A move with nowhere recorded is
  // titled by neither — no title beats the wrong one; the header falls back to the live prompt.
  async function generateAndStoreTitle(sessionId: string, cwd: string): Promise<void> {
    const transcriptId = transcriptIdOf(sessionId);
    if (titleInFlight.has(sessionId) || transcriptId === null) return;
    // The default source needs one folded field, not the conversation — and session-reads keeps
    // that fold cached and incremental, so this costs the bytes that arrived since the last read
    // rather than the file. Before this branch existed, an untitled session streamed its whole
    // transcript once per turn to find a string that was already in memory.
    if (!titleNeedsTurns()) {
      const epoch = titleEpoch.get(sessionId) ?? 0;
      const { aiTitle } = await readSessionSummary(cwd, transcriptId);
      // A move during the read bumped the epoch (forgetTitle): this title is the conversation's it left.
      if ((titleEpoch.get(sessionId) ?? 0) === epoch) storeKnownTitle(sessionId, aiTitle, deps);
      return;
    }
    await summarizeAndStoreTitle(sessionId, transcriptId, cwd, deps);
  }

  // At Stop (the assistant's reply is now on disk), regenerate a pending title from the
  // recent turns and publish it. Fire-and-forget; a failure leaves the last prompt showing.
  async function maybeGenerateTitle(sessionId: string, cwd: string | undefined): Promise<void> {
    if (!cwd || !titlePending.has(sessionId) || titleInFlight.has(sessionId)) return;
    titlePending.delete(sessionId);
    await generateAndStoreTitle(sessionId, cwd);
  }

  // The grid roster titles on our side even for sessions the hook path never runs on (unmanaged /
  // resumed / post-restart), so it never shows a stale externally-written title. Fire-and-forget
  // from the view; the freshened title lands on the next roster poll.
  //
  // `diskAiTitle` is the field the route ALREADY read on this request. Taking it is what closes
  // the divergence both reviewers landed on (#1772): Claude Code appends its `ai-title` without a
  // new user turn, so a turn-based staleness rule refused to look again — the sidebar showed that
  // title (it reads disk directly through `sessionListTitle`) while the cell header sat on the
  // prompt fallback. There is no scan on this path and therefore nothing to ration: no staleness
  // gate, no retry floor. Both still guard the `headless` source, which has to read the turns.
  function freshenRosterTitle(sessionId: string, cwd: string, currentUserTurns: number, diskAiTitle: string | null = null): void {
    if (!titleNeedsTurns()) {
      storeKnownTitle(sessionId, diskAiTitle, deps);
      return;
    }
    if (titleInFlight.has(sessionId)) return;
    const stale = shouldFreshenViewedTitle({
      lastTitledUserTurns: lastTitledUserTurns.get(sessionId) ?? null,
      currentUserTurns,
      regenEveryTurns: VIEW_TITLE_REGEN_TURNS,
    });
    if (!stale) return;
    const now = deps.now();
    if (now - (lastTitleAttemptMs.get(sessionId) ?? 0) < VIEW_TITLE_RETRY_MS) return;
    lastTitleAttemptMs.set(sessionId, now);
    void generateAndStoreTitle(sessionId, cwd);
  }
  return { forgetTitle, noteTitleTurn, maybeGenerateTitle, freshenRosterTitle };
}
