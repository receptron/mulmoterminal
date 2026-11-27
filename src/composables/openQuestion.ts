import { isRecord } from "../../common/isRecord";
import { isAnswerFailure, isAskQuestionEvent, type AnswerFailure, type AnswerRequestBody, type AskQuestionEvent } from "../../common/askQuestion";
import { fetchWithTimeout } from "../utils/fetchWithTimeout";
import { remoteSessionAddressOf } from "../../common/remoteHosts";
import { pathOnHost } from "../components/remoteCell";

const REQUEST_TIMEOUT_MS = 5000;

// A session is named by its key: the bare id for this machine's, `host/id` for a remote one (#3506),
// whose dialog is read and answered on its host. What the host answers names its own bare id, so
// the dialog is handed back under the key it was asked by.
const questionPath = (key: string, suffix = ""): string => {
  const remote = remoteSessionAddressOf(key);
  const id = remote?.id ?? key;
  return pathOnHost(remote?.host, `/api/question/${encodeURIComponent(id)}${suffix}`);
};

// What the question pane's channel cannot tell a browser that arrived late: the dialog a session is
// blocked on RIGHT NOW. Pub/sub here is event-only and replays nothing on reconnect, so without
// this a reload between the question and its answer leaves the pane blind to a waiting session —
// and nothing but an arriving question opens that pane.
//
// A failure answers null rather than throwing: this runs on every enlarge, and a session with no
// question open is the ordinary case, so there is nothing to report either way.
export async function fetchOpenQuestion(sessionId: string): Promise<AskQuestionEvent | null> {
  const lookup = await lookUpOpenQuestion(sessionId);
  return lookup.ok ? lookup.question : null;
}

/** The same read, telling a failed lookup apart from "nothing is asked". A caller that must not
 *  type into an open dialog (the board's reply box, #3185) cannot treat the two alike: a lookup that
 *  failed has said nothing about whether one is open. */
export type OpenQuestionLookup = { ok: true; question: AskQuestionEvent | null } | { ok: false };

export async function lookUpOpenQuestion(sessionId: string): Promise<OpenQuestionLookup> {
  try {
    const res = await fetchWithTimeout(questionPath(sessionId), undefined, REQUEST_TIMEOUT_MS);
    if (!res.ok) return { ok: false };
    const body: unknown = await res.json();
    if (!isRecord(body)) return { ok: false };
    return { ok: true, question: isAskQuestionEvent(body.question) ? { ...body.question, sessionId } : null };
  } catch {
    return { ok: false };
  }
}

// Answering goes through the HOST (#1685), not the terminal socket: it is the side that knows
// whether the dialog is still open, and having it build the keystrokes keeps the check and the
// typing in one step. The phone reaches the same code, so a third client would too.
export async function postAnswer(sessionId: string, toolUseId: string, picks: number[][]): Promise<AnswerFailure | null> {
  return postToAnswerRoute(sessionId, { toolUseId, picks });
}

// Answering in the user's own words, through the dialog's `Type something` row (#1693). The same
// route as the buttons, because it is the same act: the host checks the dialog is still the one on
// screen, then types. The words are sanitized there — this is the one thing a client sends that is
// not an index.
export async function postWords(sessionId: string, toolUseId: string, text: string): Promise<AnswerFailure | null> {
  return postToAnswerRoute(sessionId, { toolUseId, text });
}

async function postToAnswerRoute(sessionId: string, body: AnswerRequestBody): Promise<AnswerFailure | null> {
  try {
    const res = await fetchWithTimeout(
      questionPath(sessionId, "/answer"),
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
      REQUEST_TIMEOUT_MS,
    );
    if (res.ok) return null;
    const answered: unknown = await res.json().catch(() => null);
    return isRecord(answered) && isAnswerFailure(answered.reason) ? answered.reason : "unwritable";
  } catch {
    return "unwritable";
  }
}
