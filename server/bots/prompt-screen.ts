import { createHash } from "node:crypto";
import { stripPtyEscapes } from "../session/pty-scan.js";
import { idleBotScreen } from "./recovery.js";
import type { BotScreen, DetectedPrompt, PromptOption } from "./prompt-schema.js";

const choiceRow = /^([❯›>]?)\s*(\d{1,2})[.)]\s+(\S.*)$/u;
const confirmFooter = /(?:enter|return)\s+to\s+(?:select|confirm|continue|submit)/i;
const summaryLabels = new Set(["Resume from summary", "Resume from summary (recommended)", "Resume from summary (instant, recommended)"]);
export const promptFingerprint = (text: string): string => createHash("sha256").update(text).digest("hex");
export const unknownPrompt = (message: string): DetectedPrompt => ({
  kind: "unknown",
  message: message.slice(-8000),
  options: [],
  fingerprint: promptFingerprint(message.slice(-8000)),
});
export interface ChoiceScreen {
  prompt: DetectedPrompt;
  selected: string;
}

function menuOptions(rows: string[]) {
  const options: PromptOption[] = [];
  const selected: string[] = [];
  let end = 0;
  for (const row of rows) {
    const match = choiceRow.exec(row);
    if (!match) break;
    const [, caret, id, label] = match;
    if (!id || !label) break;
    options.push({ id, label });
    if (caret) selected.push(id);
    end++;
  }
  if (options.length < 2 || options.length > 9 || selected.length !== 1 || new Set(options.map((o) => o.id)).size !== options.length) return null;
  if (rows.slice(end).some(Boolean)) return null;
  return { options, selected: selected[0] ?? "" };
}

function isResume(message: string, options: PromptOption[]): boolean {
  return (
    options.length === 3 &&
    options.some((o) => summaryLabels.has(o.label)) &&
    options.some((o) => o.label === "Resume full session as-is") &&
    options.some((o) => o.label === "Don't ask me again") &&
    message.replace(/\s+/g, " ").includes("Resuming the full session will consume a substantial portion of your usage limits.")
  );
}

/** Read a current numbered menu only. A normal prompt below old menu text disqualifies it. */
export function choiceScreen(styled: string): ChoiceScreen | null {
  if (idleBotScreen(styled) !== null) return null;
  const rows = stripPtyEscapes(styled)
    .split("\n")
    .map((row) => row.trim());
  const footer = rows.findLastIndex((row) => confirmFooter.test(row));
  if (footer < 0 || rows.slice(footer + 1).some(Boolean)) return null;
  const selectedRow = rows.slice(0, footer).findLastIndex((row) => choiceRow.exec(row)?.[1]);
  if (selectedRow < 0) return null;
  let start = selectedRow;
  while (start > 0 && choiceRow.test(rows[start - 1] ?? "")) start--;
  const menu = menuOptions(rows.slice(start, footer));
  if (!menu) return null;
  if (/space(?:bar)?\s+to\s+(?:select|toggle)/i.test(rows.slice(start).join(" ")) || menu.options.some((o) => /^[☐☑]|^\[[ xX]\]/u.test(o.label))) return null;
  const message = rows.slice(0, start).join("\n").trim().slice(-8000);
  const kind = isResume(message, menu.options) ? "resume-summary" : "choice";
  return {
    prompt: { kind, message, options: menu.options, fingerprint: promptFingerprint(JSON.stringify({ message, options: menu.options })) },
    selected: menu.selected,
  };
}

export function botScreen(styled: string): BotScreen {
  const idle = idleBotScreen(styled) !== null;
  const menu = choiceScreen(styled);
  if (idle || menu) return { idle, prompt: menu?.prompt ?? null };
  const text = stripPtyEscapes(styled).trimEnd();
  // Unrecognized input UI is diagnostic only, never a source of automatic keystrokes.
  const tail = text.split("\n").slice(-3).join("\n");
  const waiting = confirmFooter.test(tail) || /(?:paste|enter) (?:your )?(?:authentication code|authorization code|api key)/i.test(tail);
  return { idle: false, prompt: waiting ? unknownPrompt(text) : null };
}
