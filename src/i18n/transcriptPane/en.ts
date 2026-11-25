export const transcriptPaneEn = {
  transcriptPane: {
    title: "Conversation",
    loadingOlder: "loading older…",
    scrollOlder: "Scroll up for older turns.",
    cutHere: "…cut here",
    speakers: { agent: "Agent", you: "You", tools: "Tools", unreadable: "Unreadable block" },
    empty: {
      failed: "Couldn't read this session's conversation.",
      notStarted: "This cell hasn't started a session yet.",
      loading: "Loading…",
      cleared: "This conversation was ended with /clear. The next prompt starts a new one.",
      tooLarge: "This transcript is too large to find a turn in.",
      notSupported: "This agent keeps its conversation somewhere this pane can't read yet.",
      none: "Nothing written to this session's transcript yet.",
    },
    head: {
      failed: "Couldn't read the turns before this one.",
      tooLarge: "The turns before this are too large to read.",
      cleared: "The conversation before this was ended with /clear.",
      start: "The start of this conversation.",
      none: "Nothing older could be read.",
    },
  },
} as const;
