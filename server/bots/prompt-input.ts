import type { BotPrompt } from "./prompt-schema.js";
import { choiceScreen } from "./prompt-screen.js";

export interface PromptTerminal {
  capture: () => string | null;
  exclusive: () => boolean;
  write: (text: string) => void;
  pause: () => Promise<void>;
}

/** Answer only the still-current choice menu. Never accept raw keys or text from an LLM. */
export async function answerChoice(terminal: PromptTerminal, prompt: BotPrompt, optionId: string): Promise<boolean> {
  const target = prompt.options.findIndex((option) => option.id === optionId);
  if (target < 0 || prompt.kind === "unknown") return false;
  for (let attempt = 0; attempt < prompt.options.length + 2; attempt++) {
    if (!terminal.exclusive()) return false;
    const raw = terminal.capture();
    const screen = raw === null ? null : choiceScreen(raw);
    if (!screen || screen.prompt.fingerprint !== prompt.fingerprint) return false;
    const selected = prompt.options.findIndex((option) => option.id === screen.selected);
    if (selected < 0) return false;
    if (selected === target) {
      // No host callback can interleave here. The external CLI can still redraw;
      // its terminal protocol offers no atomic compare-and-submit operation.
      terminal.write("\r");
      return true;
    }
    terminal.write(selected > target ? "\x1b[A" : "\x1b[B");
    await terminal.pause();
  }
  return false;
}
