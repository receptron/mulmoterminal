// Restarting the agent in a cell that is already running one: reap the session, then reconnect
// the same slot to the same session id, so the server spawns a NEW process and resumes the same
// conversation (#1918). Changing an MCP registration, a config file or a plugin needs exactly
// this, and until now cost a trip back through the launcher.
//
// The order is the whole rule, and it is why this is a function rather than two lines at the call
// site. A session runs inside tmux, and reconnecting to a tmux session that is still alive
// ATTACHES it — see ptyWouldReattach in server/session/pty/pty-spawn.ts: "on the attach path nothing
// is re-read, because nothing is re-started". So a reconnect that overtakes the reap gets the OLD
// process back, with the old config, and looks exactly like a restart that worked.
import { fetchWithTimeout } from "../utils/fetchWithTimeout";
import { jsonBody } from "../jsonBody";
import { sessionWritePath } from "../components/remoteCell";

/** Everything the restart does to the world, injected so the ordering above can be tested. */
export interface RestartSteps {
  /** End the session server-side — pty AND tmux. Resolves to whether the server confirmed it. */
  reap: (sessionId: string) => Promise<boolean>;
  /** Point the slot at the same session again; the server has nothing live, so it spawns. */
  reconnect: () => void;
}

export type RestartOutcome =
  /** Nothing was running — a cell still on its launch form. */
  | "no-session"
  | "restarted"
  /** The server did not confirm the reap, so nothing was reconnected. The caller has to SAY so. */
  | "reap-failed";

export async function restartSession(sessionId: string | null, steps: RestartSteps): Promise<RestartOutcome> {
  if (!sessionId) return "no-session";
  // An unconfirmed reap does NOT reconnect (codex on #1920). Both ways the request can fail leave
  // reconnecting worse than useless: a refusal means the session is untouched and still in tmux, so
  // `new-session -A` hands back the very process we were asked to replace, and an unreachable server
  // will not answer the new socket either. Either way the screen would clear and redraw — a restart,
  // to look at. The caller reports instead, and a second press retries.
  if (!(await steps.reap(sessionId))) return "reap-failed";
  steps.reconnect();
  return "restarted";
}

/** The close button's own route (POST /api/session/:id/terminate): it kills the pty and the tmux
 *  session, and kills a tmux session orphaned by an earlier server run even when no pty is live.
 *
 *  The answer read here is the route's `ended` — its post-condition, "nothing of this session is
 *  running any more" — not the 2xx, which only says the request was accepted (CodeRabbit on #1920).
 *  Strictly `=== true`: an unreadable body parses to `{}`, and jsonBody's own warning is that a
 *  caller recording success must not take that for an answer. Unconfirmed here costs a retry; a
 *  false confirmation costs a restart that silently did not happen. */
export async function reapSessionOnServer(sessionId: string, host: string | null = null): Promise<boolean> {
  try {
    const res = await fetchWithTimeout(sessionWritePath(host, sessionId, "terminate"), { method: "POST" });
    if (!res.ok) {
      console.warn(`[restart] terminate ${sessionId} answered HTTP ${res.status}`);
      return false;
    }
    const ended = (await jsonBody(res)).ended === true;
    if (!ended) console.warn(`[restart] terminate ${sessionId} did not end the session`);
    return ended;
  } catch (e) {
    console.warn(`[restart] terminate ${sessionId} failed: ${e instanceof Error ? e.message : String(e)}`);
    return false;
  }
}

/** Move a rotated session to the subscription the user picked (#2950): the server pins the pick for the
 *  next spawn and ends the session exactly as the close button does. Resolves to the same answer
 *  `reapSessionOnServer` gives — whether nothing of the session is running any more — so it drops into
 *  `restartSession` as the reap step, and an unconfirmed switch reconnects nothing. */
export async function switchTokenOnServer(sessionId: string, tokenId: string): Promise<boolean> {
  try {
    const res = await fetchWithTimeout(`/api/session/${encodeURIComponent(sessionId)}/switch-token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tokenId }),
    });
    if (!res.ok) {
      console.warn(`[restart] switch-token ${sessionId} answered HTTP ${res.status}`);
      return false;
    }
    return (await jsonBody(res)).ended === true;
  } catch (e) {
    console.warn(`[restart] switch-token ${sessionId} failed: ${e instanceof Error ? e.message : String(e)}`);
    return false;
  }
}
