import { parseStyledRows } from "../session/screen-rows.js";
import { claudeAdapter } from "../agents/claude.js";
import { squashForMarker } from "../session/pty-scan.js";

const ESC = "\u001b";
// Claude 2.1.274 renders the active editor file as a cyan UI badge in an empty
// prompt. Require its actual styling and the whole prompt row; plain lookalikes
// and any text beside the badge remain drafts.
const IDE_CONTEXT_ROW = new RegExp(`^(?:${ESC}\\[[\\d;]*m)*[ \\t]*❯[ \\t\\u00a0]*${ESC}\\[38;5;74m\\[⧉ In [^\\r\\n\\]]+\\]${ESC}\\[39m[ \\t]*$`, "u");

// Only inspect the current input box, never a ready marker left in scrollback.
// Unknown layouts fail closed. Dim suggestions are not drafts and are not accepted by paste.
export function idleBotScreen(styled: string): string | null {
  const rows = parseStyledRows(styled);
  const bottom = rows.findLastIndex((row) => /^\s*─{8,}\s*$/u.test(row.text));
  if (bottom < 2) return null;
  const top = rows.slice(0, bottom).findLastIndex((row) => /^\s*─{8,}\s*$/u.test(row.text));
  if (top < 0) return null;
  const box = rows.slice(top + 1, bottom);
  const first = box[0];
  if (!first || !/^\s*❯(?:\s|$)/u.test(first.text)) return null;
  const empty = first.text.replace(/^\s*❯(?:\s|$)/u, "").trim() === first.dim.trim();
  if (!empty && !IDE_CONTEXT_ROW.test(styled.split("\n")[top + 1] ?? "")) return null;
  if (box.slice(1).some((row) => row.text.trim() !== row.dim.trim())) return null;
  const footer = squashForMarker(
    rows
      .slice(bottom + 1)
      .map((row) => row.text)
      .join("\n"),
  );
  if (!claudeAdapter.draftReadyMarker.test(footer) || /esc.*(?:interrupt|cancel)|enter.*(?:confirm|select|continue|submit)/.test(footer)) return null;
  return rows
    .slice(top)
    .map((row) => `${row.text}\t${row.dim}`)
    .join("\n");
}

/** Two matching captures across a settling interval; lifecycle hooks always take precedence. */
export class BotRecovery {
  private candidates = new Map<string, { screen: string; at: number } | null>();
  add(id: string): void {
    this.candidates.set(id, null);
  }
  check(phase: (id: string) => string, capture: (id: string) => string | null, recovered: (id: string) => void): void {
    for (const [id, previous] of this.candidates) {
      if (phase(id) !== "unknown") {
        this.candidates.delete(id);
        continue;
      }
      const raw = capture(id);
      const screen = raw === null ? null : idleBotScreen(raw);
      if (screen === null) this.candidates.set(id, null);
      else if (previous?.screen !== screen) this.candidates.set(id, { screen, at: Date.now() });
      else if (Date.now() - previous.at >= 750) {
        recovered(id);
        this.candidates.delete(id);
      }
    }
  }
}
