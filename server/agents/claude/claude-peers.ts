// What the other Claude Code sessions on this machine call one of ours (#3237).
//
// Claude Code keeps one small JSON per running process under `<claude home>/sessions/<pid>.json`,
// and its ListAgents / SendMessage address a session by the `name` in it (`myrepo-66`). The name
// is Claude Code's to derive and to change (a user, a peer or a hook may rename it), so it is read,
// never computed here. The entry also names the tmux pane the process runs in, and MulmoTerminal
// is what named that tmux session — so a cell is matched to its entry through the session name
// MulmoTerminal gave tmux, and only where there is no tmux through claude's own session id, which
// is the one MulmoTerminal started it with until `/clear` or `/compact` reissues it.
import { isRecord } from "../../../common/isRecord.js";

export interface ClaudePeer {
  name: string;
  pid: number;
  sessionId: string | null;
  /** The tmux session the process runs in, without the window and pane Claude Code appends. */
  tmuxSession: string | null;
  /** When Claude Code last wrote the entry, for choosing between two that claim one cell. */
  updatedAt: number;
}

const stringOrNull = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);
const finiteOr = (value: unknown, fallback: number): number => (typeof value === "number" && Number.isFinite(value) ? value : fallback);

/** `mt-abc:@1.%1` → `mt-abc`: the registry writes the whole pane target. */
export function tmuxSessionOf(target: unknown): string | null {
  const text = stringOrNull(target);
  if (text === null) return null;
  return stringOrNull(text.split(":")[0]);
}

/** One registry entry, or null for a file that is not one (no name, no usable pid). */
export function parseClaudePeer(value: unknown): ClaudePeer | null {
  if (!isRecord(value)) return null;
  const name = stringOrNull(value.name);
  const pid = value.pid;
  if (name === null || typeof pid !== "number" || !Number.isInteger(pid) || pid <= 0) return null;
  return {
    name,
    pid,
    sessionId: stringOrNull(value.sessionId),
    tmuxSession: tmuxSessionOf(value.tmux),
    updatedAt: finiteOr(value.updatedAt, finiteOr(value.startedAt, 0)),
  };
}

export interface PeerKeys {
  /** MulmoTerminal's session id, which claude was started with. */
  sessionId: string;
  /** The tmux session MulmoTerminal named for it. */
  tmuxSession: string;
}

const latestOf = (peers: readonly ClaudePeer[]): ClaudePeer | null =>
  peers.reduce<ClaudePeer | null>((best, peer) => (best === null || peer.updatedAt > best.updatedAt ? peer : best), null);

/** The name of the peer running this cell's session: the one in its tmux session, else the one
 *  claude knows by its id. Of several claiming it — an entry a crashed process left behind, a
 *  resumed session — the one written last. */
export function peerNameFor(peers: readonly ClaudePeer[], keys: PeerKeys): string | null {
  const inTmux = peers.filter((peer) => peer.tmuxSession === keys.tmuxSession);
  const claiming = inTmux.length > 0 ? inTmux : peers.filter((peer) => peer.sessionId === keys.sessionId);
  return latestOf(claiming)?.name ?? null;
}
