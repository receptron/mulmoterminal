// The draft-vs-auto-run decision behind attachDraftInjection, pulled out so the precedence and
// the never-auto-submit-a-draft rule can be decided without a PTY or timers.

export interface DraftPlan {
  text: string;
  // An initialPrompt is typed AND submitted (Enter); a draft is only typed, so the user reviews
  // and sends it themselves. Auto-submitting a draft would fire unreviewed text.
  autoSubmit: boolean;
}

// A draft takes precedence over an initialPrompt when both are present (`??`, so an empty-string
// draft still shadows the initialPrompt). Returns null — a no-op — when there is nothing to type,
// or the text sanitizes to empty. `sanitize` is injected so the rule can be tested without the
// real control-byte stripper.
export function planDraftInjection(initialPrompt: string | undefined, draft: string | undefined, sanitize: (text: string) => string): DraftPlan | null {
  const pendingText = draft ?? initialPrompt;
  if (pendingText === undefined) return null;
  const text = sanitize(pendingText);
  if (!text) return null;
  return { text, autoSubmit: draft === undefined && initialPrompt !== undefined };
}
