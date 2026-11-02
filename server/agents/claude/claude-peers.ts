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
  /** When the claude registered itself, by its own clock, for checking the process against. */
  startedAt: number | null;
}

const stringOrNull = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);

/** A name is typed into another session's message tool and shown on a tooltip, so it is bounded
 *  here whatever the registry holds: Claude Code derives `<folder>-<two hex digits>`, and a name
 *  somebody set by hand is short too. One past this, or holding a control character, is not an
 *  entry of ours and the file is ignored. */
export const MAX_PEER_NAME_CHARS = 128;
const CONTROL_CHARACTER = /\p{Cc}/u;

const peerNameOrNull = (value: unknown): string | null => {
  const name = stringOrNull(value)?.trim() ?? "";
  if (name === "" || name.length > MAX_PEER_NAME_CHARS || CONTROL_CHARACTER.test(name)) return null;
  return name;
};
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
  const name = peerNameOrNull(value.name);
  const pid = value.pid;
  if (name === null || typeof pid !== "number" || !Number.isInteger(pid) || pid <= 0) return null;
  return {
    name,
    pid,
    sessionId: stringOrNull(value.sessionId),
    tmuxSession: tmuxSessionOf(value.tmux),
    updatedAt: finiteOr(value.updatedAt, finiteOr(value.startedAt, 0)),
    startedAt: typeof value.startedAt === "number" && Number.isFinite(value.startedAt) ? value.startedAt : null,
  };
}

/** How far a process's start, by the OS's account, may sit from the entry's own `startedAt`: the
 *  registration runs a few seconds into the process, never a minute. */
export const START_TOLERANCE_MS = 60_000;

/** `ps -o pid=,lstart=` lines (`  7848 Mon Nov  2 20:57:38 2026`) as pid → start, epoch ms. A line
 *  that is not one is skipped. */
export function parsePsStartTimes(stdout: string): Map<number, number> {
  const starts = new Map<number, number>();
  stdout.split("\n").forEach((line) => {
    const [pid, ...start] = line.trim().split(/\s+/);
    if (pid === undefined || !/^\d+$/.test(pid)) return;
    const startedAt = Date.parse(start.join(" "));
    if (Number.isFinite(startedAt)) starts.set(Number(pid), startedAt);
  });
  return starts;
}

/** The peers whose process is the one that wrote the entry. A pid proves only that SOME process owns
 *  the number: a claude that crashed leaves its file, and the number can come round again to a
 *  process that is nothing of the kind. So where the OS can say when the process started, it has to
 *  agree with the entry; a pid the OS does not list, or an entry with no start of its own, is
 *  dropped. Where the OS cannot say (`starts` is null), liveness is all there is. */
export function withVerifiedStarts(peers: readonly ClaudePeer[], starts: ReadonlyMap<number, number> | null): ClaudePeer[] {
  if (starts === null) return [...peers];
  return peers.filter((peer) => {
    const osStart = starts.get(peer.pid);
    return osStart !== undefined && peer.startedAt !== null && Math.abs(osStart - peer.startedAt) <= START_TOLERANCE_MS;
  });
}

export interface PeerKeys {
  /** MulmoTerminal's session id, which claude was started with. */
  sessionId: string;
  /** The tmux session MulmoTerminal named for it. */
  tmuxSession: string;
}

const latestOf = (peers: readonly ClaudePeer[]): ClaudePeer | null =>
  peers.reduce<ClaudePeer | null>((best, peer) => (best === null || peer.updatedAt > best.updatedAt ? peer : best), null);

/** The name of the peer running this cell's session: the one in its tmux session, else — for a
 *  claude started without tmux, which names no tmux session at all — the one claude knows by its
 *  id. A peer that names ANOTHER tmux session is another cell's whatever its id says: the same
 *  conversation resumed elsewhere. Of several claiming the cell — an entry a crashed process left
 *  behind, a resumed session — the one written last. */
export function peerNameFor(peers: readonly ClaudePeer[], keys: PeerKeys): string | null {
  const inTmux = peers.filter((peer) => peer.tmuxSession === keys.tmuxSession);
  const claiming = inTmux.length > 0 ? inTmux : peers.filter((peer) => peer.tmuxSession === null && peer.sessionId === keys.sessionId);
  return latestOf(claiming)?.name ?? null;
}
