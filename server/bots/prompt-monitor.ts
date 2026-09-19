import { stripPtyEscapes } from "../session/pty-scan.js";
import { botScreen, promptFingerprint, unknownPrompt } from "./prompt-screen.js";
import type { BotScreen } from "./prompt-schema.js";

/** A missing hook must not leave an accepted request silently stuck forever. This is a
 * diagnostic timeout, not proof that Claude stopped working, and it never generates keys. */
export class PromptMonitor {
  private snapshots = new Map<string, { fingerprint: string; since: number }>();
  touch(id: string): void {
    this.snapshots.delete(id);
  }
  inspect(id: string, styled: string, outstanding: boolean): BotScreen {
    const screen = botScreen(styled);
    if (!outstanding || screen.prompt) {
      this.touch(id);
      return screen;
    }
    const text = stripPtyEscapes(styled).trimEnd().slice(-8000);
    const fingerprint = promptFingerprint(text);
    const previous = this.snapshots.get(id);
    if (!previous || previous.fingerprint !== fingerprint) this.snapshots.set(id, { fingerprint, since: Date.now() });
    else if (Date.now() - previous.since >= 120000) {
      return {
        idle: false,
        prompt: unknownPrompt(
          `No CLI progress or screen change was observed for two minutes. The request may still be running. Inspect this diagnostic; do not resend or send arbitrary keys.\n\n${text}`,
        ),
      };
    }
    return screen;
  }
}
