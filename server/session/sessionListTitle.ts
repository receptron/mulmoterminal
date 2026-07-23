// The title a sidebar row shows, in five-tier precedence: this process's live AI title
// wins, then the on-disk ai-title, then the on-disk last-prompt, then the session's first
// user message, and a sentinel when there is nothing at all.
//
// `||` is load-bearing here, and DIFFERENT from the `??` in session-detail-view.ts: every
// tier is a string that must be SKIPPED when empty. A live title of "" is not "the user
// cleared it, show blank" (that is the detail view's contract) — here it means "this
// process has no usable live title, fall through to disk". Tidying `||` into `??` would
// pin an empty string as the row's title and hide the real one sitting on disk right below.

export interface SessionListTitleInput {
  liveAiTitle: string | undefined;
  diskAiTitle: string | null;
  diskLastPrompt: string | null;
  firstUserMsg: string | null;
}

export const UNTITLED_SESSION = "(untitled session)";

export function sessionListTitle(input: SessionListTitleInput): string {
  return input.liveAiTitle || input.diskAiTitle || input.diskLastPrompt || input.firstUserMsg || UNTITLED_SESSION;
}
