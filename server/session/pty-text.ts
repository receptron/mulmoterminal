// Sanitizers for text that is typed into a PTY on someone's behalf (a draft prompt,
// an excerpt handed over from another session). The content is untrusted: it may be
// an agent's own output, so it must not be able to inject terminal control sequences
// that break out of the surrounding bracketed paste and submit or interrupt the turn.

// ALL control bytes (C0/C1 — ESC, Ctrl-C, CR/LF, and an embedded bracketed-paste
// terminator). ESC being in the range is what makes stripping sufficient: no escape
// sequence can survive with its introducer gone.
// eslint-disable-next-line no-control-regex -- intentional: match terminal control bytes (C0/C1) to strip them
const CONTROL_BYTES_RE = /[\u0000-\u001F\u007F-\u009F]+/g;

// One line of printable text, whitespace collapsed. Used where the target is a
// single-line input (an auto-run prompt, a draft typed into the input box).
export function sanitizeDraftText(text: string): string {
  return text.replace(CONTROL_BYTES_RE, " ").replace(/\s+/g, " ").trim();
}

// Printable text with line structure preserved. Each line is sanitized in isolation —
// so every control byte is still stripped — and the newlines rejoining them are ours,
// never the input's. Safe ONLY inside a bracketed paste, where the TUI takes a bare
// LF as literal text rather than a submit. Runs of blank lines collapse to one.
export function sanitizeMultilineText(text: string): string {
  const lines = text.split(/\r?\n/).map((line) =>
    line
      .replace(CONTROL_BYTES_RE, " ")
      .replace(/[^\S\n]+/g, " ")
      .trim(),
  );
  const out: string[] = [];
  for (const line of lines) {
    if (line || out[out.length - 1]) out.push(line);
  }
  return out.join("\n").trim();
}
