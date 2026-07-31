// What a user's scheduled task's chat IS, as opposed to how it is spawned.
//
// Split from index.ts for the reason background-chat.ts was split from its route: the rules below
// are policy, and the caller is otherwise a uuid, a spawn and a try/catch. Policy nothing can
// assert is policy that drifts — and this one is two halves that have to agree.
//
// A scheduled chat is a BACKGROUND WORKER, the same as `spawnBackgroundChat hidden:true`, because
// it is dispatched by a clock rather than by someone at a keyboard. It was already half of one:
// `scheduledSessions.register` puts it on the background retention, whose stated reason is that
// "nobody is waiting for it to finish and nothing else would ever end it". The chat list still
// showed it as a session the user had started. These two now agree.
//
// Two consequences follow, and both are the point rather than side effects:
//   - it takes NO grid cell. A visible spawn is marked unplaced so the next grid adopts it, and
//     for a task firing hourly that is a cell per firing, forever — reaching MAX_TERMINALS with
//     nobody having asked for a single terminal.
//   - a FAILED one still says so. Quiet is right while it works and wrong when it dies: nothing
//     pulls the user's attention, so without the hook a failed task is never learned.
import { backgroundMarkers, markFailedWorker } from "./registry.js";
import { runWithHiddenMarker } from "./hiddenMarker.js";
import { registerCompletionHook } from "./completion-hooks.js";

export interface ScheduledChatDeps {
  /** Start the PTY. Separate so the policy can be exercised without spawning anything. */
  spawn: (sessionId: string) => void;
  /** Put it on the scheduled-session retention — nothing else would ever end it. */
  retain: (sessionId: string) => void;
}

/**
 * Run a scheduled task's chat as a background worker.
 *
 * The completion hook is registered AFTER the spawn: a launch that threw has no session to report
 * on, and registering first would leave a hook nothing will ever fire or clear.
 *
 * Claude-only by construction — this path always spawns claude — which matters because the Stop
 * hook is the only success signal a PTY-hosted agent gives. A recorder on an agent that cannot
 * report success would mark every successful run as failed.
 */
export function spawnScheduledWorker(sessionId: string, deps: ScheduledChatDeps): void {
  runWithHiddenMarker(true, sessionId, backgroundMarkers, () => deps.spawn(sessionId));
  deps.retain(sessionId);
  registerCompletionHook(sessionId, ({ didError }) => {
    if (didError) markFailedWorker(sessionId);
  });
}
