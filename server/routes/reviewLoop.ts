// The review loop the server runs between a session and the reviewer session it started (#3409),
// pure: what requestReview accepts, the text the reviewer is sent, and what the author is told when a
// round ends. The route holds the loops and the clock; nothing here reads gh, a terminal or a file.
import type { CiState } from "../../common/ghItems.js";
import type { CodexVerdict } from "../../common/githubBoard.js";
import { isRecord } from "../../common/isRecord.js";
import { isRepoEntry } from "../../common/repoEntry.js";
import type { ReviewSettings } from "../../common/reviewSettings.js";
import { SESSION_ID_RE } from "../config/env.js";
import { parseVerdictLine } from "../git/codexVerdict.js";
import type { Parsed } from "./sessionAsk.js";

const MS_PER_MINUTE = 60_000;
// A reviewer reading a large PR and running its tests takes minutes, not seconds; past this the
// author is told to look at the reviewer's cell rather than wait on a session that may be stuck.
export const REVIEW_WAIT_MINUTES = 60;
export const REVIEW_WAIT_MS = REVIEW_WAIT_MINUTES * MS_PER_MINUTE;
const SHORT_SHA_CHARS = 7;
// GitHub's own limits: an owner of 39 characters and a name of 100. A longer one names no repository,
// and the review request repeats the name, so this is what keeps it inside one send.
const MAX_REPO_CHARS = 140;

export interface ReviewRound {
  head: string;
  /** null: the round ended without a verdict line, or the reviewer never answered. */
  verdict: CodexVerdict | null;
}

export interface ReviewLoop {
  repo: string;
  pr: number;
  /** The session that asked: the author, told how each round ended. */
  author: string;
  reviewer: string;
  /** The worktree MulmoTerminal checked the PR's head out in for a reviewer it started, else null. */
  workspace: string | null;
  rounds: ReviewRound[];
  running: boolean;
}

export interface ReviewTarget {
  repo: string;
  pr: number;
}

/** One loop per PR, whatever case the repository is written in. */
export const loopKey = ({ repo, pr }: ReviewTarget): string => `${repo.toLowerCase()}#${pr}`;

function targetOf(record: Record<string, unknown>): ReviewTarget | null {
  const repo = typeof record.repo === "string" ? record.repo.trim() : "";
  const pr = record.pr;
  if (!isRepoEntry(repo) || repo.length > MAX_REPO_CHARS || typeof pr !== "number" || !Number.isInteger(pr) || pr < 1) return null;
  return { repo, pr };
}

const TARGET_REQUIRED = "`repo` must be owner/repo and `pr` a pull request number.";

/** `reviewer` null: MulmoTerminal keeps the PR's reviewer, starting one when there is none. */
export function parseReviewRequest(body: unknown): Parsed<ReviewTarget & { reviewer: string | null }> {
  const record = isRecord(body) ? body : {};
  const target = targetOf(record);
  if (target === null) return { ok: false, error: TARGET_REQUIRED };
  if (record.reviewer === undefined || record.reviewer === null) return { ok: true, ...target, reviewer: null };
  const reviewer = typeof record.reviewer === "string" && SESSION_ID_RE.test(record.reviewer) ? record.reviewer : null;
  if (reviewer === null)
    return { ok: false, error: "`reviewer`, when given, must be the chatId of a reviewer session you started; leave it out to have one started." };
  return { ok: true, ...target, reviewer };
}

export function parseEndRequest(body: unknown): Parsed<ReviewTarget> {
  const target = targetOf(isRecord(body) ? body : {});
  return target === null ? { ok: false, error: TARGET_REQUIRED } : { ok: true, ...target };
}

/** The verdict a reply opens with, counted only when it names the head that was asked about: an
 *  LGTM for some other commit says nothing about this one. */
export function verdictFor(reply: string, head: string): CodexVerdict | null {
  const line = parseVerdictLine(reply.trimStart());
  return line !== null && line.sha !== "" && head.startsWith(line.sha) ? line.verdict : null;
}

/** Why `reviewer` may not review `target`, or null: a session reviews one PR, since its reply is
 *  matched by its last turn and ending either loop would close it under the other. */
export function reviewerRefusal(loops: Iterable<ReviewLoop>, target: ReviewTarget, reviewer: string): string | null {
  const key = loopKey(target);
  const other = [...loops].find((loop) => loop.reviewer === reviewer && loopKey(loop) !== key);
  return other === undefined ? null : `Session ${reviewer} is already reviewing ${other.repo}#${other.pr}; start another reviewer for this PR.`;
}

/** What the author is told when the reviewer session stops running mid-round. */
export const reviewerGoneMessage = (loop: ReviewLoop): string =>
  `[requestReview] ${loop.repo}#${loop.pr}: reviewer session ${loop.reviewer} is no longer running, so round ${loop.rounds.length + 1} did not finish and was not counted. ${
    loop.workspace === null
      ? "Call endReview, start a new reviewer, and call requestReview with it — or ask the user."
      : "Call requestReview again without `reviewer` and MulmoTerminal starts a new one — or ask the user."
  }`;

/** What the author is told, once per round, when the reviewer stops on a question or a permission
 *  prompt: nothing else would say so before the round's whole wait ran out. */
export const reviewerHeldMessage = (loop: ReviewLoop): string =>
  `[requestReview] ${loop.repo}#${loop.pr}: reviewer session ${loop.reviewer} is waiting for the user — a question or a permission prompt in its cell — so round ${loop.rounds.length + 1} is paused. Tell the user to answer it in that cell; the round goes on by itself once it is answered.`;

export const lgtmCountOn = (rounds: readonly ReviewRound[], head: string): number =>
  rounds.filter((round) => round.head === head && round.verdict === "lgtm").length;

const short = (sha: string): string => sha.slice(0, SHORT_SHA_CHARS);

export interface RoundRequest {
  author: string;
  reviewer: string;
  head: string;
}

/** Why this round may not start, or null when it may. Checked against the loop already running on
 *  the PR, so one reviewer stays with one PR and a head that was turned down is not asked about again. */
export function roundRefusal(loop: ReviewLoop | undefined, request: RoundRequest, settings: ReviewSettings): string | null {
  if (loop === undefined) return null;
  if (loop.author !== request.author) return `Another session is running the review of ${loop.repo}#${loop.pr}.`;
  if (loop.reviewer !== request.reviewer)
    return `${loop.repo}#${loop.pr} is reviewed by session ${loop.reviewer}; one reviewer stays with one PR. Call endReview first to start over with another.`;
  if (loop.running) return `Round ${loop.rounds.length + 1} of ${loop.repo}#${loop.pr} is still running; you will be told when it ends.`;
  if (loop.rounds.length >= settings.maxRounds)
    return `${loop.repo}#${loop.pr} has had ${loop.rounds.length} review rounds, the most this repository allows. Ask the user how to go on.`;
  const last = loop.rounds.at(-1);
  if (last?.head === request.head && last.verdict === "changes")
    return `Head ${short(request.head)} was already reviewed with changes requested. Fix the findings and push before asking again.`;
  if (lgtmCountOn(loop.rounds, request.head) >= settings.requiredLgtm)
    return `Head ${short(request.head)} already has the LGTMs this repository requires; nothing more to review.`;
  return null;
}

export interface PromptFacts extends ReviewTarget {
  head: string;
  round: number;
  maxRounds: number;
  skill: string;
}

/** What the reviewer is sent. It arrives as one line, so it is written as sentences, not a list. */
export function reviewPrompt({ repo, pr, head, round, maxRounds, skill }: PromptFacts): string {
  const parts = [
    `Review pull request #${pr} of ${repo} at head ${head} (round ${round} of at most ${maxRounds}).`,
    `Follow the ${skill} skill for how to review; where it and this message differ on the verdict line or the PR comment, this message wins.`,
    `Read it with gh pr view ${pr} -R ${repo} and gh pr diff ${pr} -R ${repo}.`,
    "Do not modify, check out or commit in any existing checkout; to run code, make your own worktree or clone in a temporary directory.",
    "Report every finding you have in this one round, each with a severity (P1 must fix, P2 should fix, P3 optional, N a note that does not block) and file:line, and the smallest change that resolves it.",
    `Begin your reply with exactly one line: REVIEW VERDICT: LGTM (head ${head}) or REVIEW VERDICT: CHANGES REQUESTED (head ${head}).`,
    `Then post the same reply as a comment on the PR: write it to a file and run gh pr comment ${pr} -R ${repo} --body-file <that file>.`,
  ];
  if (round > 1)
    parts.push(
      "The author has answered your earlier findings in this head: check that each was actually fixed, and say so when a finding repeats one you raised before.",
    );
  return parts.join(" ");
}

export interface PrNow {
  open: boolean;
  head: string;
  ci: CiState;
}

export interface RoundEnd {
  loop: ReviewLoop;
  settings: ReviewSettings;
  /** The PR as it is when the round ends, or null when it could not be read. */
  now: PrNow | null;
  timedOut: boolean;
}

function ciPhrase(ci: CiState): string {
  if (ci === "passing") return "every CI check passes";
  if (ci === "none") return "no CI checks are reported yet";
  return `CI is ${ci}`;
}

const LAST_ROUND = "That was the last round this repository allows: ask the user how to go on.";

function lgtmNext(loop: ReviewLoop, settings: ReviewSettings, now: PrNow | null): string {
  if (now === null) return "The PR could not be read to check the merge condition; check it with gh pr view before merging.";
  if (!now.open) return "The PR is no longer open, so there is nothing to merge: call endReview.";
  const count = lgtmCountOn(loop.rounds, now.head);
  const lgtm = `${count}/${settings.requiredLgtm} LGTM on the current head`;
  if (count < settings.requiredLgtm) {
    const again = loop.rounds.length < settings.maxRounds ? "call requestReview again for another review of this head." : LAST_ROUND;
    return `${lgtm}: ${again}`;
  }
  if (now.ci !== "passing") return `${lgtm}, but ${ciPhrase(now.ci)}: merge once every check passes (gh pr checks --watch).`;
  return `Merge condition met: ${lgtm} and ${ciPhrase(now.ci)}. You may merge it (merge commit), then call endReview.`;
}

function nextStep(end: RoundEnd, round: ReviewRound, readIt: string): string {
  const { loop, settings, now, timedOut } = end;
  const left = settings.maxRounds - loop.rounds.length;
  const retry = left > 0 ? `${left} rounds left.` : LAST_ROUND;
  if (timedOut)
    return `The reviewer has not answered in ${REVIEW_WAIT_MINUTES} minutes. Look at its cell, then call requestReview again or ask the user. ${retry}`;
  if (round.verdict === null) return `Its reply has no REVIEW VERDICT line. ${readIt} Then call requestReview again or ask the user. ${retry}`;
  if (round.verdict === "changes") return `${readIt} Fix them, push, then call requestReview again. ${retry}`;
  return lgtmNext(loop, settings, now);
}

function verdictPhrase(round: ReviewRound, timedOut: boolean): string {
  if (timedOut) return "no answer";
  if (round.verdict === "lgtm") return "LGTM";
  return round.verdict === "changes" ? "CHANGES REQUESTED" : "no verdict";
}

/** What the author is told when a round ends — typed into its session, so one line. */
export function roundEndMessage(end: RoundEnd): string {
  const { loop, settings, now, timedOut } = end;
  const round = loop.rounds.at(-1);
  if (round === undefined) return "";
  const readIt = `Read the review with waitForSessionReply {"session":"${loop.reviewer}"} (it answers at once).`;
  const parts = [
    `[requestReview] ${loop.repo}#${loop.pr} round ${loop.rounds.length}/${settings.maxRounds}, reviewer ${settings.reviewer} (session ${loop.reviewer}):`,
    `${verdictPhrase(round, timedOut)} on head ${short(round.head)}.`,
  ];
  if (now !== null && now.head !== round.head) parts.push(`The PR has moved to ${short(now.head)} since; that head is not reviewed yet.`);
  parts.push(nextStep(end, round, readIt));
  return parts.join(" ");
}
