import { z } from "zod";

export const promptOptionSchema = z.object({ id: z.string(), label: z.string() });
export const botPromptSchema = z.object({
  id: z.uuid(),
  botId: z.uuid(),
  owner: z.uuid(),
  requestId: z.uuid().nullable(),
  kind: z.enum(["resume-summary", "choice", "unknown"]),
  message: z.string(),
  options: z.array(promptOptionSchema),
  fingerprint: z.string(),
  screenCleared: z.boolean().default(false),
  state: z.enum(["waiting", "answering", "uncertain", "resolved"]),
  createdAt: z.number(),
  answerId: z.string().nullable(),
  answeredBy: z.string().nullable(),
  notified: z.boolean(),
  read: z.boolean(),
});
export type BotPrompt = z.infer<typeof botPromptSchema>;
export type PromptOption = z.infer<typeof promptOptionSchema>;
export type DetectedPrompt = Pick<BotPrompt, "kind" | "message" | "options" | "fingerprint">;
export interface BotScreen {
  prompt: DetectedPrompt | null;
  idle: boolean;
}
export const promptView = ({ id, kind, message, options, state, answerId, requestId, screenCleared }: BotPrompt) => ({
  promptId: id,
  kind,
  message,
  options,
  state: state === "resolved" && answerId !== null && !screenCleared ? "answering" : state,
  answerId,
  requestId,
});
