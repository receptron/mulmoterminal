// Pure decision for what a Claude hook does to the cell header and its AI title.
//
// The sibling of activityHookEffects, and the reason this exists: that one — which sets the
// working/waiting flags — is extracted and tested, while this one was left inside the route.
// So the flags could stay right while the header lied, which is the harder failure to
// notice: the dot says "working" and the header still shows the task the user abandoned two
// prompts ago.
//
// The caller does the work each effect names (read the transcript, blank the maps, publish,
// queue a title); this only decides which one, if any.

export type HeaderHookEffect =
  // Record this as the session's current query. Already trimmed and capped.
  | { kind: "prompt"; text: string }
  // `/clear` restarted the conversation — the header must stop showing the pre-clear prompt.
  | { kind: "clear" }
  // A turn's reply is on disk; (re)generate the AI title from it.
  | { kind: "title" };

// A prompt longer than this is a paste, not a headline — the header shows one line.
export const LAST_PROMPT_CAP = 200;

// Null means "this hook changes nothing about the header", which is the common case: every
// tool hook, every SessionStart that is not a `/clear`, and — deliberately — a
// UserPromptSubmit carrying a blank or non-string prompt. Blanking the header on an empty
// submit would erase the query the user is still waiting on.
export function headerHookEffect(event: string, body: Record<string, unknown>, cap: number = LAST_PROMPT_CAP): HeaderHookEffect | null {
  if (event === "UserPromptSubmit") {
    if (typeof body.prompt !== "string" || !body.prompt.trim()) return null;
    return { kind: "prompt", text: body.prompt.trim().slice(0, cap) };
  }
  // Only `source: "clear"`. A `/compact` also arrives as SessionStart, and clearing on it
  // would wipe the user's task line and their title in the middle of a conversation that is
  // still going.
  if (event === "SessionStart") return body.source === "clear" ? { kind: "clear" } : null;
  if (event === "Stop") return { kind: "title" };
  return null;
}
