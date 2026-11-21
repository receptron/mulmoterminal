// Every pty is registered through here, so "a terminal now exists for this session" is announced in
// one place rather than at each spawner.
import { ptys } from "../registry.js";
import type { PtyEntry } from "../types.js";

type PtyRegisteredListener = (sessionId: string, entry: PtyEntry) => void;

let listener: PtyRegisteredListener | null = null;

/** Set by the server once pub/sub exists; a registration before then announces nothing. */
export function onPtyRegistered(next: PtyRegisteredListener | null): void {
  listener = next;
}

export function registerPty(sessionId: string, entry: PtyEntry): void {
  ptys.set(sessionId, entry);
  listener?.(sessionId, entry);
}
