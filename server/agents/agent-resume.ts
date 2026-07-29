// Which of an agent's own conversations a requested session key resumes, if any.
//
// Shared by codex (a rollout id) and antigravity (a conversation id) because the problem is the
// same for both, and so is the answer: the browser-facing id is a key MulmoTerminal minted, while
// the agent's own id is discovered after the spawn. So a key can mean two different things, and
// the order matters — an id we recorded FOR that key wins over treating the key as that id
// itself. Reverse them and a key that happens to also name a conversation resumes the wrong one.
//
// The other half is the guard: a cold resume is only attempted when there is nothing live to
// reattach. Without it a reattach also carries a resume id into the spawner, starting a
// second codex on a conversation already running in tmux.

export interface AgentResumeFacts {
  // The agent's own conversation id this server recorded for the key, if it started that session.
  mappedId?: string | null;
  // Whether the key is itself the id of a conversation on disk (the sidebar hands these over).
  // A thunk, not a value: it reads the filesystem, and a reattach must not pay for a probe
  // whose answer it is about to discard.
  conversationExists: () => boolean;
  hasLivePty: boolean;
  tmuxAlive: boolean;
}

export function agentResumeId(requested: string | null, facts: AgentResumeFacts): string | null {
  if (!requested || facts.hasLivePty || facts.tmuxAlive) return null;
  return facts.mappedId || (facts.conversationExists() ? requested : null);
}
