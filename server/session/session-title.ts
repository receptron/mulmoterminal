// The session's AI-generated title: when it is due, generating it without letting two
// triggers race, and voiding a result that a /clear made stale. Split from index.ts
// (#548 step 3f) — the rules for WHETHER to (re)generate already live in
// config/header-title.ts; this is the bookkeeping around them.
//
// Four guards do the real work and are easy to lose in a rewrite: an epoch that drops a
// title generated across a /clear, the cleared-transcript mark that stops the NEXT turn
// generating one from that same pre-clear file, an in-flight set so a Stop hook and a roster
// view do not both summarize, and a retry floor so a viewed-but-failing session is not
// re-summarized on every poll.
import path from "node:path";
import { conversationTurnsFromParsed, isTrivialPrompt, type ConversationTurn } from "./transcript.js";
import { forEachJsonlRecord } from "../infra/jsonl-file.js";
import { shouldFreshenViewedTitle, shouldRegenerateTitle, TITLE_REGEN_EVERY_TURNS, VIEW_TITLE_REGEN_TURNS } from "../config/header-title.js";
import { aiTitles, lastTitleAttemptMs, lastTitledUserTurns, titleEpoch, titleInFlight, titlePending, titleTurnCounts } from "./registry.js";
import { clearedTranscripts } from "./cleared-transcripts.js";
import { projectSessionsDir } from "./project-dir.js";

// How long a viewed session that failed to summarize waits before being tried again, so a
// roster poll cannot spawn a summarizer per request.
const VIEW_TITLE_RETRY_MS = 30_000;

export interface TitleDeps {
  /** Push the session's row (with its new title) to subscribers. */
  publishActivity: (id: string) => void;
  /** Injected so the retry floor can be tested without waiting out 30 seconds. */
  now: () => number;
  /** Summarize a transcript into a title. Injected because the real one shells out to
   *  the claude CLI, which a unit test must never do. */
  // Turns, not the raw transcript: the file reaches 585 MB here and cannot be held as a string
  // at all (#998). The title only reads the last few turns anyway.
  generateTitle: (turns: ConversationTurn[]) => Promise<string | null>;
}

export function createTitleManager(deps: TitleDeps) {
  // Drop all AI-title bookkeeping for a session (on /clear or teardown). Bumping the epoch
  // voids any in-flight generation started before this reset — its (now pre-clear) title
  // must not resurface after the header was cleared.
  function forgetTitle(sessionId: string): void {
    aiTitles.delete(sessionId);
    titleTurnCounts.delete(sessionId);
    titlePending.delete(sessionId);
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

  // Read the transcript, summarize its recent turns into a title, and store + publish it.
  // Epoch-guarded: a /clear or teardown mid-generation bumps the epoch, so the now-stale
  // result is dropped. In-flight-guarded so overlapping triggers (a Stop hook and a roster
  // view) don't both summarize. Never throws — a failed/timed-out CLI just leaves the prior title.
  async function generateAndStoreTitle(sessionId: string, cwd: string): Promise<void> {
    if (titleInFlight.has(sessionId)) return;
    // A cleared session has no transcript to title from: claude moved to a new one and ours is
    // frozen on the conversation the user just ended, so this is where the pre-clear title kept
    // coming back — forgetTitle makes the next turn think a title is DUE, and the only turns on
    // disk are the ended ones (#1085). No title beats the wrong one; the header falls back to the
    // live prompt.
    if (clearedTranscripts.has(sessionId)) return;
    titleInFlight.add(sessionId);
    const epoch = titleEpoch.get(sessionId) ?? 0;
    try {
      // One streamed pass yields both what the title needs (the turns) and what the bookkeeping
      // needs (how many user turns there were), so the transcript is never held as a string.
      const turns: ConversationTurn[] = [];
      let read = true;
      await forEachJsonlRecord(path.join(projectSessionsDir(cwd), `${sessionId}.jsonl`), (record) => {
        turns.push(...conversationTurnsFromParsed([record]));
      }).catch(() => (read = false));
      const title = read && turns.length ? await deps.generateTitle(turns) : null;
      if (title && (titleEpoch.get(sessionId) ?? 0) === epoch) {
        aiTitles.set(sessionId, title);
        titleTurnCounts.set(sessionId, 0);
        lastTitledUserTurns.set(sessionId, turns.filter((t) => t.role === "user").length);
        deps.publishActivity(sessionId);
      }
    } finally {
      titleInFlight.delete(sessionId);
    }
  }

  // At Stop (the assistant's reply is now on disk), regenerate a pending title from the
  // recent turns and publish it. Fire-and-forget; a failure leaves the last prompt showing.
  async function maybeGenerateTitle(sessionId: string, cwd: string | undefined): Promise<void> {
    if (!cwd || !titlePending.has(sessionId) || titleInFlight.has(sessionId)) return;
    titlePending.delete(sessionId);
    await generateAndStoreTitle(sessionId, cwd);
  }

  // The grid roster summarizes on our side even for sessions the hook path never runs on
  // (unmanaged / resumed / post-restart), so it never shows a stale externally-written title.
  // Fire-and-forget from the view; the freshened title lands on the next roster poll.
  function freshenRosterTitle(sessionId: string, cwd: string, currentUserTurns: number): void {
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
