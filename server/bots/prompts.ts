import { randomUUID } from "node:crypto";
import type { Bot, BotStore } from "./store.js";
import { promptView, type BotPrompt, type BotScreen, type DetectedPrompt } from "./prompt-schema.js";
import { unknownPrompt } from "./prompt-screen.js";

export type AnswerPrompt = (bot: Bot, prompt: BotPrompt, optionId: string) => Promise<boolean>;

/** The answer claim is persisted before any key is sent. A crash must never replay Enter. */
export class BotPrompts {
  private observed = new Map<string, { fingerprint: string; at: number }>();
  constructor(
    private readonly store: BotStore,
    private readonly answer?: AnswerPrompt,
  ) {}

  active(botId: string): BotPrompt | undefined {
    return this.store.state.prompts.findLast(
      (prompt) => prompt.botId === botId && (prompt.state !== "resolved" || (prompt.answerId !== null && !prompt.screenCleared)),
    );
  }

  record(bot: Bot, detected: DetectedPrompt): BotPrompt {
    const previous = this.active(bot.id);
    if (previous?.fingerprint === detected.fingerprint) {
      if (!this.observed.has(bot.id)) this.observed.set(bot.id, { fingerprint: detected.fingerprint, at: Date.now() });
      return previous;
    }
    const request = bot.requests.find((item) => item.state === "sent" || item.state === "uncertain") ?? bot.requests.find((item) => item.state === "queued");
    const prompt: BotPrompt = {
      ...detected,
      id: randomUUID(),
      botId: bot.id,
      owner: request?.requester ?? bot.owner,
      requestId: request?.id ?? null,
      state: "waiting",
      screenCleared: false,
      createdAt: Date.now(),
      answerId: null,
      answeredBy: null,
      notified: false,
      read: false,
    };
    this.store.change((state) => {
      if (previous) {
        const saved = state.prompts.find((item) => item.id === previous.id);
        if (saved) {
          saved.state = "resolved";
          saved.screenCleared = true;
        }
      }
      state.prompts.push(prompt);
    });
    this.observed.set(bot.id, { fingerprint: detected.fingerprint, at: Date.now() });
    return prompt;
  }

  blocked(bot: Bot, message: string): void {
    if (!this.active(bot.id)) this.record(bot, unknownPrompt(message));
  }

  forgetObservation(botId: string): void {
    this.observed.delete(botId);
  }

  observe(bot: Bot, screen: BotScreen): void {
    if (screen.prompt) this.record(bot, screen.prompt);
    else {
      this.observed.delete(bot.id);
      const prompt = this.active(bot.id);
      const uncertainTask = prompt?.kind === "unknown" && bot.requests.some((request) => request.id === prompt.requestId && request.state === "uncertain");
      if (prompt?.answerId !== null && prompt?.answerId !== undefined) {
        this.store.change((state) => {
          const saved = state.prompts.find((item) => item.id === prompt.id);
          if (saved) saved.screenCleared = true;
        });
      }
      if (screen.idle && !uncertainTask) this.resolve(bot.id);
    }
  }

  resolve(botId: string): void {
    const prompt = this.active(botId);
    if (!prompt || prompt.state === "resolved") return;
    this.store.change((state) => {
      const saved = state.prompts.find((item) => item.id === prompt.id);
      if (saved) saved.state = "resolved";
    });
    this.observed.delete(botId);
  }

  async automatic(bot: Bot): Promise<void> {
    const prompt = this.active(bot.id);
    const observed = this.observed.get(bot.id);
    if (!prompt || prompt.state !== "waiting" || prompt.kind !== "resume-summary" || bot.resumePolicy !== "summary") return;
    if (!observed || observed.fingerprint !== prompt.fingerprint || Date.now() - observed.at < 750) return;
    const option = prompt.options.find((item) => item.label.startsWith("Resume from summary"));
    if (option) await this.respond("automatic-summary-policy", bot, prompt.id, option.id);
  }

  async respond(owner: string, bot: Bot, promptId: string, optionId: string) {
    const prompt = this.active(bot.id);
    if (!bot.alive || !prompt || prompt.id !== promptId) throw new Error("This Bot question is no longer current. Refresh manageBot inspect.");
    if (prompt.state !== "waiting") throw new Error("An answer was already claimed. Do not retry; inspect the Bot's current state.");
    if (!prompt.options.some((option) => option.id === optionId) || prompt.kind === "unknown")
      throw new Error("This screen cannot accept that choice. No keys were sent.");
    if (!this.answer) throw new Error("Bot prompt response is unavailable.");
    this.update(prompt.id, "answering", optionId, owner);
    try {
      const submitted = await this.answer(bot, prompt, optionId);
      if (!submitted) {
        this.update(prompt.id, "uncertain", optionId, owner);
        throw new Error("The dialog changed or could not be verified. No answer was submitted; inspect the current Bot state.");
      }
      return { promptId, status: this.store.state.prompts.find((item) => item.id === promptId)?.state ?? "answering" };
    } catch (error) {
      this.update(prompt.id, "uncertain", optionId, owner);
      throw error;
    }
  }

  private update(id: string, status: BotPrompt["state"], optionId: string, owner: string): void {
    this.store.change((state) => {
      const saved = state.prompts.find((item) => item.id === id);
      if (saved && saved.state !== "resolved") {
        saved.state = status;
        saved.answerId = optionId;
        saved.answeredBy = owner;
        if (status === "uncertain") {
          saved.read = false;
          saved.notified = false;
        }
      }
    });
  }

  recover(): void {
    this.store.change((state) => {
      for (const prompt of state.prompts) {
        if (prompt.state === "answering") prompt.state = "uncertain";
        if (prompt.state !== "resolved") prompt.notified = false;
      }
    });
  }

  notices(owner: string, includeRead: boolean) {
    const prompts = this.store.state.prompts.filter((prompt) => prompt.owner === owner && prompt.state !== "resolved" && (includeRead || !prompt.read));
    const ids = new Set(prompts.map((prompt) => prompt.id));
    if (ids.size)
      this.store.change((state) => {
        for (const prompt of state.prompts) if (ids.has(prompt.id)) prompt.read = true;
      });
    return prompts.map((prompt) => ({
      id: prompt.id,
      botId: prompt.botId,
      requestId: prompt.requestId,
      kind: "question" as const,
      text: "Claude Code needs attention; inspect the prompt state and diagnostic. The task is preserved. Use manageBot inspect, then respond only to a waiting prompt with listed options if authorized. Do not resend the task or kill the Bot.",
      prompt: promptView(prompt),
    }));
  }
}
