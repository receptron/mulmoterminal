// A conservative input lease. Silence never proves an empty TUI draft. User input dirties
// the draft until a real prompt-submit hook. During an automatic paste/Enter, user bytes
// wait for that prompt's acknowledgement, so they cannot merge into the injected message.
type Phase = "unknown" | "busy" | "ready" | "blocked";
interface InputState {
  phase: Phase;
  dirty: boolean;
  readyAt: number;
  lease: number | null;
  acceptedLease: number | null;
  pending: Array<() => void> | null;
}
const inputs = new Map<string, InputState>();
let nextLease = 0;
const stateOf = (id: string): InputState => {
  let state = inputs.get(id);
  if (!state) {
    state = { phase: "unknown", dirty: false, readyAt: 0, lease: null, acceptedLease: null, pending: null };
    inputs.set(id, state);
  }
  return state;
};

export const botInputAccepted = (id: string, lease: number): boolean => inputs.get(id)?.acceptedLease === lease;
export const botInputPending = (id: string, lease: number): boolean => inputs.get(id)?.lease === lease;

export const botInputPhase = (id: string): Phase => stateOf(id).phase;
export const botInputReady = (id: string): boolean => {
  const state = stateOf(id);
  return state.phase === "ready" && Date.now() >= state.readyAt && !state.dirty && state.pending === null;
};
export const noteBotUserInput = (id: string): void => {
  stateOf(id).dirty = true;
};

/** Only a surviving hidden Bot can recover from a verified empty, idle tmux screen. */
export function recoverBotInput(id: string, afterDialog = false): void {
  const state = stateOf(id);
  if ((state.phase !== "unknown" && !(afterDialog && state.phase === "blocked")) || state.dirty || state.pending !== null) return;
  state.phase = "ready";
  state.readyAt = Date.now() + 750;
}

export function deferDuringBotDelivery(id: string, write: () => void): boolean {
  const pending = inputs.get(id)?.pending;
  if (!pending) return false;
  pending.push(write);
  return true;
}

function release(state: InputState): void {
  const pending = state.pending;
  state.pending = null;
  state.lease = null;
  for (const write of pending ?? []) {
    try {
      write();
    } catch {
      console.warn("[bots] deferred terminal input could not be written");
    }
  }
}

export function observeBotInputHook(id: string, event: string, source?: unknown): void {
  const state = stateOf(id);
  if ((event === "UserPromptSubmit" || event === "PreCompact") && state.lease !== null) state.acceptedLease = state.lease;
  if (event === "UserPromptSubmit") {
    state.phase = "busy";
    state.dirty = false;
    release(state);
  } else if (event === "Stop" || event === "IdlePrompt" || (event === "SessionStart" && source === "compact")) {
    state.phase = "ready";
    state.readyAt = Date.now() + 750;
    release(state);
  } else if (event === "Notification" || event === "PreCompact") {
    state.phase = event === "Notification" ? "blocked" : "busy";
    release(state);
  } else if (event === "PreToolUse" || event === "PostToolUse" || event === "PostToolUseFailure") {
    state.phase = "busy";
  }
}

export function claimBotInput(id: string): number | null {
  if (!botInputReady(id)) return null;
  const state = stateOf(id);
  state.phase = "busy";
  state.pending = [];
  state.lease = ++nextLease;
  return state.lease;
}

/** Failure is not readiness. Retain the draft flag, and require a fresh lifecycle event. */
export function abandonBotInput(id: string, lease: number): void {
  const state = stateOf(id);
  if (state.pending === null || state.lease !== lease) return;
  state.phase = "unknown";
  state.dirty = true;
  release(state);
}

export const forgetBotInput = (id: string): void => {
  inputs.delete(id);
};
