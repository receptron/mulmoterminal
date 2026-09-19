// Representative CLI layouts; fail closed when an installed version renders another layout.
export const idleScreen = "────────────────\n❯ \n────────────────\n? for shortcuts\n";
export const resumeScreen = (selected = "2") =>
  [
    "This session is 2h old and 150k tokens.",
    "Resuming the full session will consume a substantial portion of your usage limits.",
    "We recommend resuming from a summary.",
    "",
    ...["Resume from summary (recommended)", "Resume full session as-is", "Don't ask me again"].map(
      (label, index) => `${String(index + 1) === selected ? "❯" : " "} ${index + 1}. ${label}`,
    ),
    "",
    "Enter to confirm · Esc to cancel",
    "",
  ].join("\n");
export const permissionScreen = (selected = "2", command = "Run the project tests?") =>
  [command, "", `${selected === "1" ? "❯" : " "} 1. Yes`, `${selected === "2" ? "❯" : " "} 2. No`, "", "Enter to select · Esc to cancel", ""].join("\n");
