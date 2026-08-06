import fs from "node:fs";
import path from "node:path";
import { SESSION_ID_RE } from "../config/env.js";

const ROLLOUT_ID_RE = SESSION_ID_RE;

export function parseLegacyCodexRolloutId(contents: string, sessionId: string): string | null {
  if (!SESSION_ID_RE.test(sessionId)) return null;
  let found: string | null = null;
  for (const line of contents.split(/\r?\n/u)) {
    const [sid, rollout] = line.split("\t");
    if (sid === sessionId && rollout && ROLLOUT_ID_RE.test(rollout)) found = rollout;
  }
  return found;
}

export function readLegacyCodexRolloutId(home: string, sessionId: string): string | null {
  try {
    return parseLegacyCodexRolloutId(fs.readFileSync(path.join(home, "codex-rollout-ids.tsv"), "utf8"), sessionId);
  } catch {
    return null;
  }
}
