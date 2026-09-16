import { ptys } from "../session/registry.js";
import { isBotSession, markBotSession } from "./session-marker.js";
import { handleBotHook } from "./host.js";
import { isActionableNotification } from "../session/activity-hook.js";
import { SESSION_ID_RE } from "../config/env.js";

function noteQuestion(id: string, body: Record<string, unknown>, event: string): void {
  if (event === "PreToolUse" && body.tool_name === "AskUserQuestion")
    handleBotHook(id, "Notification", undefined, `Claude Code asks: ${JSON.stringify(body.tool_input)}`);
}

/** Return true for internal Bots: their hooks must not create terminal rows or push notifications. */
export function observeSessionBotHook(id: string | null, body: Record<string, unknown>, event: string, notificationType: string | undefined): boolean {
  if (!id) return false;
  const isClaude = ptys.get(id)?.agent === "claude";
  const bot = isBotSession(id);
  // /compact can issue another transcript id; keep its history hidden after kill as well.
  if (bot && typeof body.session_id === "string" && SESSION_ID_RE.test(body.session_id)) markBotSession(body.session_id);
  if (!bot && !isClaude) return false;
  if (event === "Notification") {
    if (!isActionableNotification(notificationType)) return bot;
    // A Bot cannot acquire a user's draft through the UI. Frontends can, so idle_prompt
    // must never clear their unknown state or be mistaken for a permission dialog.
    if (notificationType === "idle_prompt") {
      if (bot) handleBotHook(id, "IdlePrompt");
      return bot;
    }
  }
  handleBotHook(id, event, body.source, typeof body.message === "string" ? body.message : undefined);
  if (bot) noteQuestion(id, body, event);
  return bot;
}
