// Which codex conversation a requested session key resumes, if any.
//
// The browser-facing id is a key MulmoTerminal minted; codex's own rollout id is discovered
// after the spawn. So a key can mean two different things, and the order matters: a rollout
// id we recorded FOR that key wins over treating the key as a rollout id itself. Reverse
// them and a key that happens to also name a rollout resumes the wrong conversation.
//
// The other half is the guard: a cold resume is only attempted when there is nothing live to
// reattach. Without it a reattach also carries a resume id into the spawner, starting a
// second codex on a conversation already running in tmux.

export interface CodexResumeFacts {
  // The rollout id this server recorded for the key, if it started that session.
  mappedRolloutId?: string | null;
  // Whether the key is itself the id of a rollout on disk (the sidebar hands these over).
  // A thunk, not a value: it reads the filesystem, and a reattach must not pay for a probe
  // whose answer it is about to discard.
  rolloutExists: () => boolean;
  hasLivePty: boolean;
  tmuxAlive: boolean;
}

export function codexResumeId(requested: string | null, facts: CodexResumeFacts): string | null {
  if (!requested || facts.hasLivePty || facts.tmuxAlive) return null;
  return facts.mappedRolloutId || (facts.rolloutExists() ? requested : null);
}
