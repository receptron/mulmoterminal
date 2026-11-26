// The acting terminal's past prompts as command-palette rows (#2523). Pure.
import type { Cell } from "../components/gridTabs";
import type { PromptEntry } from "../../common/promptHistory";
import type { TerminalAgent } from "../../common/sessionAgent";

/** Whose prompts: an agent terminal with a session, and where its input goes. */
export interface PalettePromptSource {
  uid: number;
  slotKey: string;
  session: string;
  agent: TerminalAgent;
  cwd: string | null;
  /** The remote host the session runs on (#3506), null for this machine: its prompts are read there. */
  host: string | null;
}

export interface PalettePrompt {
  /** Its place in the history as read, newest first: stable while the palette is open. */
  index: number;
  text: string;
  /** The terminal it was read from, which is where it goes back: not whichever acts at the pick. */
  uid: number;
  slotKey: string;
}

/** A command or launcher cell runs no agent, and a cell without a session has sent nothing yet.
 *  A custom agent's cell keeps `agent` absent, as Claude's does, because it runs Claude Code. */
export function promptSourceOf(cell: Cell | null): PalettePromptSource | null {
  if (!cell || !cell.session || cell.command || cell.launcher) return null;
  return { uid: cell.uid, slotKey: `cell-${cell.uid}`, session: cell.session, agent: cell.agent ?? "claude", cwd: cell.cwd, host: cell.remoteHost ?? null };
}

/** Newest first, the order the Prompts pane reads them in. */
export const palettePrompts = (oldestFirst: readonly PromptEntry[], { uid, slotKey }: PalettePromptSource): PalettePrompt[] =>
  [...oldestFirst].reverse().map((entry, index) => ({ index, text: entry.text, uid, slotKey }));

/** The row's name: the first line, which is what a person recognises a prompt by. */
export const promptFirstLine = (text: string): string =>
  text
    .split("\n")
    .find((line) => line.trim() !== "")
    ?.trim() ?? text.trim();
