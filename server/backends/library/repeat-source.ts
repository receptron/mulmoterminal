// What the repeated-instruction check reads (#3334): every prompt in Claude Code's prompt log with the
// directory it was typed in (which the index does not keep), and the sessions the index knows to be
// automated. Runs on the index's worker. The log is read again only when its size or time changed.
import { stat } from "node:fs/promises";
import type { DatabaseSync } from "node:sqlite";
import { AUTOMATED_ENTRYPOINT } from "../../../common/library.js";
import { finiteNumber } from "../../../common/finiteNumber.js";
import { readString } from "../../../common/readString.js";
import { forEachJsonlRecord } from "../../infra/fs/jsonl-file.js";
import type { RepeatPrompt } from "./repeat-detect.js";

/** One line of the prompt log as a prompt, or null when it names no session or holds no text. */
export function repeatPromptOf(record: Record<string, unknown>): RepeatPrompt | null {
  const text = readString(record.display);
  const sessionId = readString(record.sessionId);
  if (text.trim() === "" || sessionId === "") return null;
  const project = readString(record.project);
  return { text, sessionId, project: project === "" ? null : project, at: finiteNumber(record.timestamp) ?? 0 };
}

/** The sessions the index holds as automated, temporary or a subagent's. */
export function automatedSessions(db: DatabaseSync): Set<string> {
  const rows = db.prepare("select distinct id from conversations where entrypoint = ? or is_temporary = 1 or is_sidechain = 1").all(AUTOMATED_ENTRYPOINT);
  return new Set(rows.map((row) => readString(row.id)));
}

async function readPrompts(file: string): Promise<RepeatPrompt[]> {
  const prompts: RepeatPrompt[] = [];
  await forEachJsonlRecord(file, (record) => {
    const prompt = repeatPromptOf(record);
    if (prompt !== null) prompts.push(prompt);
  });
  return prompts;
}

/** The prompt log's prompts, read again only when the file changed. Calls that overlap share the read
 *  in flight; a read that failed is not kept, so the next call reads again. A missing log has none. */
export function promptLogReader(file: string, read: (file: string) => Promise<RepeatPrompt[]> = readPrompts): () => Promise<RepeatPrompt[]> {
  let held: { stamp: string; prompts: Promise<RepeatPrompt[]> } | null = null;
  return async () => {
    const info = await stat(file).catch(() => null);
    if (info === null) return [];
    const stamp = `${String(info.size)}:${String(info.mtimeMs)}`;
    if (held?.stamp !== stamp) {
      const entry = { stamp, prompts: read(file) };
      held = entry;
      entry.prompts.catch(() => {
        if (held === entry) held = null;
      });
    }
    return held.prompts;
  };
}
