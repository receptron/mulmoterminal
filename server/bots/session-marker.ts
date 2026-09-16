import fs from "node:fs";
import path from "node:path";
import { mulmoterminalHome } from "../infra/mulmoterminal-home.js";

const validId = (id: string): boolean => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
const directory = (): string => path.join(mulmoterminalHome(), "bot-sessions");

/** Tombstones remain after kill: Bot transcripts must never become ordinary chat history. */
export function isBotSession(id: string): boolean {
  return validId(id) && fs.existsSync(path.join(directory(), id));
}

export function markBotSession(id: string): void {
  if (!validId(id)) throw new Error("Invalid Bot session id");
  if (isBotSession(id)) return;
  fs.mkdirSync(directory(), { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(directory(), id), "bot\n", { mode: 0o600 });
}
