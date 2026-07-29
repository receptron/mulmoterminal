import type { AgentAdapter } from "./types.js";

export const antigravityAdapter = {
  kind: "antigravity",
  bin: () => process.env.ANTIGRAVITY_BIN || "agy",
  binEnvVar: "ANTIGRAVITY_BIN",
} satisfies AgentAdapter;
