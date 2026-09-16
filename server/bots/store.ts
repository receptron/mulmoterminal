import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { botPromptSchema } from "./prompt-schema.js";

const requestSchema = z.object({
  id: z.uuid(),
  requester: z.uuid(),
  text: z.string(),
  kind: z.enum(["task", "compact"]),
  createdAt: z.number(),
  state: z.enum(["queued", "sent", "replied", "uncertain"]),
});
const botSchema = z.object({
  id: z.uuid(),
  sessionId: z.uuid(),
  // Creator metadata and creation quota only; all frontend terminals may use this Bot.
  owner: z.uuid(),
  name: z.string(),
  role: z.string(),
  cwd: z.string(),
  alive: z.boolean(),
  resumePolicy: z.enum(["summary", "ask"]).default("summary"),
  requests: z.array(requestSchema),
});
const replySchema = z.object({
  id: z.uuid(),
  botId: z.uuid(),
  requestId: z.uuid(),
  owner: z.uuid(),
  text: z.string(),
  kind: z.enum(["result", "error", "question"]),
  notified: z.boolean(),
  read: z.boolean(),
});
const stateSchema = z.object({ version: z.literal(3), bots: z.array(botSchema), replies: z.array(replySchema), prompts: z.array(botPromptSchema) });
export type Bot = z.infer<typeof botSchema>;
export type BotRequest = z.infer<typeof requestSchema>;
export type BotReply = z.infer<typeof replySchema>;
export type BotState = z.infer<typeof stateSchema>;

// v1 allowed only the creator to enqueue work, so that creator is the unambiguous
// destination of every legacy request. Keep existing mailbox recipients unchanged.
const v2Schema = stateSchema.omit({ prompts: true }).extend({ version: z.literal(2) });
const legacySchema = v2Schema.extend({
  version: z.literal(1),
  bots: z.array(botSchema.extend({ requests: z.array(requestSchema.omit({ requester: true })) })),
});
function readState(input: unknown): BotState {
  const parsed = z.union([stateSchema, v2Schema, legacySchema]).parse(input);
  if (parsed.version === 3) return parsed;
  if (parsed.version === 2) return { ...parsed, version: 3, prompts: [] };
  return {
    ...parsed,
    version: 3,
    prompts: [],
    bots: parsed.bots.map((bot) => ({
      ...bot,
      requests: bot.requests.map((request) => ({ ...request, requester: bot.owner })),
    })),
  };
}

/** One writer per listening port. A failed or malformed read must not silently erase Bots. */
export class BotStore {
  state: BotState;
  constructor(private readonly file: string) {
    this.state = fs.existsSync(file) ? readState(JSON.parse(fs.readFileSync(file, "utf8"))) : { version: 3, bots: [], replies: [], prompts: [] };
  }

  change(update: (state: BotState) => void): void {
    const next = structuredClone(this.state);
    update(next);
    stateSchema.parse(next);
    fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
    const temporary = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(next), { mode: 0o600 });
    fs.renameSync(temporary, this.file);
    this.state = next;
  }
}
