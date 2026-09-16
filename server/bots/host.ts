import path from "node:path";
import { mulmoterminalHome } from "../infra/mulmoterminal-home.js";
import { tmuxAvailable, tmuxHasSession, tmuxKillSession, tmuxAttachedClientCount, tmuxCaptureStyledPane } from "../infra/tmux.js";
import { ptys, backgroundMarkers } from "../session/registry.js";
import { runWithHiddenMarker } from "../session/hiddenMarker.js";
import type { SpawnClaudeOptions } from "../session/spawn-claude.js";
import type { PtyEntry } from "../session/types.js";
import { getTerminalSubmit } from "../config/config-routes.js";
import { submitSequenceForAgent, submittableLineForAgent } from "../../common/terminalSubmit.js";
import { sanitizeTerminalInput } from "../backends/remoteHost/terminalInput.js";
import { BotStore, type Bot } from "./store.js";
import { BotService } from "./service.js";
import { isBotSession, markBotSession } from "./session-marker.js";
import {
  botInputAccepted,
  botInputPending,
  botInputReady,
  botInputPhase,
  claimBotInput,
  abandonBotInput,
  observeBotInputHook,
  recoverBotInput,
} from "./input-gate.js";
import { BotRecovery } from "./recovery.js";
import { PromptMonitor } from "./prompt-monitor.js";
import { answerChoice } from "./prompt-input.js";
import type { BotPrompt } from "./prompt-schema.js";
import { callBotTool, botToolAllowed } from "./tools.js";

let service: BotService | undefined;
const monitor = new PromptMonitor();
const ready = (id: string): boolean => {
  const entry = ptys.get(id);
  return entry?.agent === "claude" && botInputReady(id) && (!entry.tmux || tmuxAttachedClientCount(id) === 1);
};

async function send(id: string, text: string): Promise<boolean> {
  const entry = ptys.get(id);
  if (!entry || !ready(id)) return false;
  if (isBotSession(id)) {
    const screen = inspectScreen(id);
    if (!screen?.idle) return false;
  }
  const lease = claimBotInput(id);
  if (lease === null) return false;
  try {
    entry.term.write(`\x1b[200~${submittableLineForAgent(entry.agent, sanitizeTerminalInput(text))}\x1b[201~`);
    await new Promise<void>((resolve) => setTimeout(resolve, 150));
    entry.term.write(submitSequenceForAgent(entry.agent, getTerminalSubmit()));
    const deadline = Date.now() + 5000;
    while (!botInputAccepted(id, lease) && botInputPending(id, lease) && Date.now() < deadline) await new Promise<void>((resolve) => setTimeout(resolve, 50));
    if (!botInputAccepted(id, lease)) throw new Error("CLI did not acknowledge automatic input; delivery may be partial.");
    return true;
  } catch (error) {
    abandonBotInput(id, lease);
    throw error;
  }
}

function inspectScreen(id: string) {
  if (tmuxAttachedClientCount(id) !== 1) {
    monitor.touch(id);
    return null;
  }
  const raw = tmuxCaptureStyledPane(id, 0);
  if (raw === null) {
    monitor.touch(id);
    return null;
  }
  const bot = service?.store.state.bots.find((item) => item.sessionId === id);
  const outstanding = bot?.requests.some((request) => request.state === "sent" || request.state === "uncertain") ?? false;
  const screen = monitor.inspect(id, raw, outstanding);
  if (screen.prompt) observeBotInputHook(id, "Notification");
  if (screen.idle && bot && service?.prompts.active(bot.id)) recoverBotInput(id, true);
  return screen;
}

async function answer(bot: Bot, prompt: BotPrompt, optionId: string): Promise<boolean> {
  const entry = ptys.get(bot.sessionId);
  if (!entry?.tmux || entry.agent !== "claude") return false;
  observeBotInputHook(bot.sessionId, "Notification");
  return answerChoice(
    {
      capture: () => tmuxCaptureStyledPane(bot.sessionId, 0),
      exclusive: () =>
        service?.store.state.bots.some((item) => item.id === bot.id && item.alive) === true &&
        service.prompts.active(bot.id)?.id === prompt.id &&
        tmuxAttachedClientCount(bot.sessionId) === 1,
      write: (text) => entry.term.write(text),
      pause: () => new Promise<void>((resolve) => setTimeout(resolve, 150)),
    },
    prompt,
    optionId,
  );
}

function spawnBotSession(bot: Bot, resume: boolean, spawn: Parameters<typeof initializeBots>[1], reap: (id: string) => void): void {
  if (!tmuxAvailable()) throw new Error("Bots require tmux.");
  const entry = runWithHiddenMarker(true, bot.sessionId, backgroundMarkers, () =>
    spawn(bot.sessionId, resume ? bot.sessionId : null, null, {
      cwd: bot.cwd,
      attachGuiMcp: true,
      botRole: bot.role,
      ...(!resume
        ? { initialPrompt: "You are a background Bot. Acknowledge readiness briefly and end this turn. Wait for host requests; never poll or wait in a tool." }
        : {}),
    }),
  );
  if (!entry.tmux) {
    reap(bot.sessionId);
    throw new Error("Bots require a host tmux session.");
  }
}

function initializeBots(
  port: number,
  spawn: (id: string, resume: string | null, ws: null, options: SpawnClaudeOptions) => PtyEntry,
  reap: (id: string) => void,
): void {
  const recovery = new BotRecovery();
  service = new BotService(new BotStore(path.join(mulmoterminalHome(), "bots", String(port), "state.json")), {
    mark: markBotSession,
    alive: (id) => ptys.has(id) || tmuxHasSession(id),
    ready,
    status: botInputPhase,
    send,
    inspect: inspectScreen,
    answer,
    kill: (id) => {
      tmuxKillSession(id);
      reap(id);
    },
    spawn: (bot, resume) => {
      spawnBotSession(bot, resume, spawn, reap);
      if (resume) recovery.add(bot.sessionId);
    },
  });
  service.recover();
  const timer = setInterval(() => {
    recovery.check(botInputPhase, (id) => (tmuxAttachedClientCount(id) === 1 ? tmuxCaptureStyledPane(id, 0) : null), recoverBotInput);
    void service?.tick().catch((error: unknown) => console.warn("[bots]", error));
  }, 750);
  timer.unref();
}

export function dispatchBotTool(sessionId: string, name: string, args: unknown): unknown {
  if (!service) throw new Error("Bot service is not available.");
  if (!botToolAllowed(name, isBotSession(sessionId))) throw new Error("Bot tool is not available to this session.");
  return callBotTool(service, sessionId, name, args, () => {
    const entry = ptys.get(sessionId);
    if (entry?.agent !== "claude") throw new Error("This first version requires a live Claude frontend for automatic replies.");
    return entry.cwd;
  });
}

export function handleBotHook(id: string, event: string, source?: unknown, message?: string): void {
  const bot = service?.store.state.bots.find((item) => item.sessionId === id);
  if (event === "IdlePrompt" && bot && service?.prompts.active(bot.id)) return;
  if (event !== "IdlePrompt") monitor.touch(id);
  observeBotInputHook(id, event, source);
  if (event === "Stop" || event === "IdlePrompt") service?.onStop(id);
  if (event === "SessionStart" && source === "compact") service?.onStop(id, true);
  if (event === "Notification") service?.onBlocked(id, message);
  if (event === "PreCompact" || event === "PreToolUse" || event === "UserPromptSubmit") service?.onProgress(id);
}

export function startBots(...args: Parameters<typeof initializeBots>): void {
  try {
    initializeBots(...args);
  } catch (error) {
    service = undefined;
    console.error("[bots] initialization failed; Bot state was preserved", error);
  }
}
