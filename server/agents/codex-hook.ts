// The one codex hook this server registers — PermissionRequest — and its translation into the body
// the Claude hook route already understands. Turn boundaries still come from the rollout tail
// (codex-activity.ts): that works whether or not the user trusts the hook, so declining codex's
// "Hooks need review" dialog costs only the blocked signal, never the working one.
//
// Measured against codex 0.156.1 (#2245): PermissionRequest fires when the approval dialog is SHOWN
// and on no other tool call, so it is the blocked-on-input signal — unlike copilot's
// `permissionRequest` and cursor's `beforeShellExecution`, which fire on every call.
import { isRecord } from "../../common/isRecord.js";

export const CODEX_PERMISSION_HOOK = "PermissionRequest";

// A CONSTANT, with the port and session read from the environment: codex asks the user to trust a
// hook again whenever its handler's hash changes, so anything per-session in here would re-open that
// dialog in every new cell. No quotes, so the TOML literal string below needs no escaping; the
// output is discarded because codex reads a hook's stdout as its decision, and `|| true` because a
// server that is down must not read as a refusal.
export const CODEX_PERMISSION_HOOK_COMMAND =
  "curl -s -m 5 -X POST -H content-type:application/json -H x-mt-agent:codex " +
  `-H x-mt-hook:${CODEX_PERMISSION_HOOK} -H x-mt-session:$MULMOTERMINAL_SESSION_ID ` +
  "-d @- http://127.0.0.1:$MULMOTERMINAL_PORT/api/hook >/dev/null 2>&1 || true";

/** The `-c` override that registers the hook. */
export const codexPermissionHookOverride = (): string =>
  `hooks.${CODEX_PERMISSION_HOOK}=[{hooks=[{type="command",command='${CODEX_PERMISSION_HOOK_COMMAND}'}]}]`;

/** Whether a codex spawn should carry the hook.
 *
 *  Not with a seed prompt: it is typed in once the screen settles, and if the one-time review dialog
 *  is what settled, the Enter picks "Review hooks" and the prompt is lost — with nobody watching, for
 *  a hidden background chat. Not on Windows: the command leans on sh expansion and `/dev/null`, and
 *  how codex runs a hook there is unmeasured. */
export function wantsCodexPermissionHook(platform: NodeJS.Platform, hasSeedPrompt: boolean): boolean {
  return platform !== "win32" && !hasSeedPrompt;
}

const str = (value: unknown): string | undefined => (typeof value === "string" && value.trim() ? value : undefined);

/** What the dialog is asking, for the push body: codex's own reason when it gave one, else the command. */
function askedFor(payload: Record<string, unknown>): string | undefined {
  const input = payload.tool_input;
  if (!isRecord(input)) return undefined;
  return str(input.description) ?? str(input.command);
}

/**
 * The Claude-shaped body, or null for a hook this server did not register.
 *
 * There is deliberately no `session_id`: codex's is its rollout id — a well-formed uuid that is not
 * ours — and the route would fall back to it when the header is missing. The session comes from the
 * `x-mt-session` header, which the command fills from the spawn's environment.
 */
export function codexHookBody(hookName: string | undefined, payload: unknown): Record<string, unknown> | null {
  if (hookName !== CODEX_PERMISSION_HOOK || !isRecord(payload)) return null;
  return {
    hook_event_name: "Notification",
    notification_type: "permission_prompt",
    cwd: str(payload.cwd),
    message: askedFor(payload),
  };
}
