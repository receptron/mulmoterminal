import type { ConnStatus } from "./useTerminalConnections";
import { copyModeOf } from "./serverMessage";
import { heatFrameOf, type HeatLevel } from "../../common/playfulEffects";

/** What a terminal view shows of its connection. */
export interface ConnViewState {
  status: ConnStatus;
  serverCwd: string | null;
  inCopyMode: boolean;
  heatLevel: HeatLevel;
  /** How many finales this socket was told of, so a view can react to each one. */
  heatFinales: number;
  /** The session itself ended (not just the client). Kept on the slot so a remounted cell still knows. */
  sessionEnded: boolean;
}

/** An exit frame marks the session ended only when the server says the session, not the client, ended. */
export function applySessionExit(view: ConnViewState | undefined, sessionEnded: boolean): void {
  if (view && sessionEnded) view.sessionEnded = true;
}

/** Only the server's own `session` frame clears it: a restart reconnecting is not yet a session that started. */
export function applySessionStart(view: ConnViewState | undefined): void {
  if (view) view.sessionEnded = false;
}

/** Apply a frame that only changes what the view shows: the copy-mode banner (#2207) and the heat. */
export function applyViewFrame(view: ConnViewState | undefined, msg: Record<string, unknown>): void {
  if (!view) return;
  const inCopyMode = copyModeOf(msg);
  if (inCopyMode !== null) view.inCopyMode = inCopyMode;
  const heat = heatFrameOf(msg);
  if (heat) Object.assign(view, { heatLevel: heat.level, heatFinales: view.heatFinales + (heat.finale ? 1 : 0) });
}
