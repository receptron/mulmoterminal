// Whether removing a worktree would throw away work, and how to say so.
//
// This is the rule standing between the user and lost work: it decides whether the close
// dialog shows the amber warning and whether its button reads "Discard & remove" or the
// reassuring "Remove worktree". Answer `false` when it should be `true` and someone deletes
// uncommitted changes believing the room was empty — so it is worth being a function with
// tests rather than two independent `computed`s that could drift apart.
//
// Both counts are optional because the diff is null until its fetch lands; absent means
// "nothing known yet", which reads as nothing to lose — the dialog shows "Checking…" over
// this until then.

export interface UnsavedWork {
  // True when the worktree holds work that removing it would destroy.
  has: boolean;
  // The warning's subject, e.g. "2 unpushed commits + 5 uncommitted changes". Empty when
  // there is nothing to lose.
  summary: string;
}

const countPhrase = (count: number, noun: string): string => `${count} ${noun}${count > 1 ? "s" : ""}`;

// Unpushed commits first: they are the harder loss to recover from.
export function unsavedWork(diff: { ahead?: number; dirty?: number } | null | undefined): UnsavedWork {
  const ahead = diff?.ahead ?? 0;
  const dirty = diff?.dirty ?? 0;
  const parts: string[] = [];
  if (ahead > 0) parts.push(countPhrase(ahead, "unpushed commit"));
  if (dirty > 0) parts.push(countPhrase(dirty, "uncommitted change"));
  return { has: parts.length > 0, summary: parts.join(" + ") };
}
