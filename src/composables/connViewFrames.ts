import type { ConnStatus } from "./useTerminalConnections";
import { copyModeOf, sessionExitOf } from "./serverMessage";
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

/** A session the server ended, or one that failed to start (`error`), marks the slot; a lost client does not. */
export function applySessionExit(view: ConnViewState | undefined, msg: Record<string, unknown>): void {
  if (view && (msg.type === "error" || sessionExitOf(msg).sessionEnded)) view.sessionEnded = true;
}

/** Output is what clears it: the server sends `session` before it spawns, so that frame proves nothing runs. */
export function applySessionOutput(view: ConnViewState | undefined): void {
  if (view?.sessionEnded) view.sessionEnded = false;
}

/** Apply a frame that only changes what the view shows: the copy-mode banner (#2207) and the heat. */
export function applyViewFrame(view: ConnViewState | undefined, msg: Record<string, unknown>): void {
  if (!view) return;
  const inCopyMode = copyModeOf(msg);
  if (inCopyMode !== null) view.inCopyMode = inCopyMode;
  const heat = heatFrameOf(msg);
  if (heat) Object.assign(view, { heatLevel: heat.level, heatFinales: view.heatFinales + (heat.finale ? 1 : 0) });
}
