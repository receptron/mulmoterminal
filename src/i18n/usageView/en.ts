// The token usage screen (#2919).
export const usageViewEn = {
  title: "Token usage",
  region: "Token usage",
  close: "Close token usage",
  intro: "What each subscription in tokenRotation has left. A new session starts on the one with the most weekly room per hour until its reset.",
  column: { subscription: "Subscription", fiveHour: "5-hour window", sevenDay: "Weekly window" },
  left: "{percent} left",
  state: {
    measuring: "Not measured yet — it is measured while this screen or the toolbar gauge is open.",
    "at-limit": "At its usage limit — skipped until it resets.",
    "no-answer": "The last check got no answer. Retrying, less often each time.",
  },
  limitReset: "{window}: resets around {at} (as last read)",
  empty: "No tokens are configured.",
};
