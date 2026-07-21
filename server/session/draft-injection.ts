// Getting a prompt INTO an agent's TUI by typing it, rather than passing it as a CLI
// argument — a long prompt overflows tmux's `new-session` command-length limit and kills
// the session. Split from index.ts (#548): the two agents differ only in how they decide
// the input box is ready, and neither decision needs any of index.ts's session state.
import { claudeAdapter } from "../agents/claude.js";
import type { PtyEntry } from "./types.js";

// Claude must have its input box + bracketed-paste mode up before it will capture a
// typed `draft`; too early and the bytes are echoed into the scrollback instead. We
// wait for its status line to paint (the "shift+tab to cycle" mode hint), settle
// briefly, then type. A fallback fires if that marker never shows (UI string drift).
const DRAFT_READY_MARKER = claudeAdapter.draftReadyMarker;
const DRAFT_SETTLE_MS = 250;
const DRAFT_FALLBACK_MS = 6000;
// Claude's TUI commits a bracketed paste to its input box asynchronously; a CR glued
// onto the same write can arrive before the paste lands and be dropped — leaving an
// auto-run prompt typed-but-unsent. Send the submitting Enter as a SEPARATE chunk a
// beat after the paste so it actually registers.
const DRAFT_SUBMIT_MS = 150;

// Sanitize a draft before typing it into a PTY: strip ALL control bytes (C0/C1 —
// ESC, Ctrl-C, CR/LF, and an embedded bracketed-paste terminator) so untrusted draft
// content can't inject terminal control sequences that break out of the paste and
// submit/interrupt. Only printable text survives, with whitespace collapsed.
// eslint-disable-next-line no-control-regex -- intentional: match terminal control bytes (C0/C1) to strip them
const DRAFT_CONTROL_BYTES_RE = /[\u0000-\u001F\u007F-\u009F]+/g;
export function sanitizeDraftText(text: string): string {
  return text.replace(DRAFT_CONTROL_BYTES_RE, " ").replace(/\s+/g, " ").trim();
}

// Deliver an auto-run prompt (initialPrompt) or an editable draft by TYPING it into
// claude's input box once it's ready — NOT as a `claude` CLI arg, which a large prompt
// would overflow tmux's `new-session` command-length limit with ("command too long",
// killing the session). ALL control bytes are stripped first — C0/C1, including ESC,
// Ctrl-C, CR/LF and an embedded bracketed-paste terminator (\e[201~) — so untrusted text
// (collection / custom-view) can't inject sequences that break out of the paste. It's
// wrapped in bracketed paste (\e[200~…\e[201~); initialPrompt then presses Enter to run
// it, while a draft gets NO Enter so the user reviews + sends. Returns a scanner to feed
// the pty output to: it types once the input-box readiness marker paints (after a settle),
// or after DRAFT_FALLBACK_MS if the marker never appears (UI drift). No-op when neither.
export function attachDraftInjection(entry: PtyEntry, initialPrompt: string | undefined, draft: string | undefined): (data: string) => void {
  const pendingText = draft ?? initialPrompt;
  const autoSubmit = draft === undefined && initialPrompt !== undefined;
  const draftText = pendingText ? sanitizeDraftText(pendingText) : "";
  if (!draftText) return () => {};
  let done = false;
  let scan = "";
  const typeDraft = () => {
    if (done) return;
    done = true;
    try {
      // Type the paste first; for an auto-run, submit with a CR in a SEPARATE write a beat
      // later (DRAFT_SUBMIT_MS) so the Enter isn't dropped while Claude's TUI is still
      // committing the paste. A draft gets no CR — the user reviews + sends.
      entry.term.write(`\x1b[200~${draftText}\x1b[201~`);
      if (autoSubmit) {
        setTimeout(() => {
          try {
            entry.term.write("\r");
          } catch {
            // pty already gone — nothing to submit
          }
        }, DRAFT_SUBMIT_MS);
      }
    } catch {
      // pty already gone — nothing to draft into
    }
  };
  // Fallback: type even if the readiness marker never appears (UI string drift).
  setTimeout(typeDraft, DRAFT_FALLBACK_MS);
  return (data: string) => {
    if (done) return;
    // Type the draft once claude's input box has painted (its mode-hint status line),
    // then settle briefly so the paste lands in the input rather than the scrollback.
    scan = (scan + data).slice(-4096);
    if (DRAFT_READY_MARKER.test(scan)) {
      scan = "";
      setTimeout(typeDraft, DRAFT_SETTLE_MS);
    }
  };
}

// codex's TUI has no stable "input ready" marker (its placeholder rotates), so instead of matching
// a string we wait for its startup output to SETTLE — the boot banner + MCP-boot spinner keep
// emitting until the input prompt is ready, so a quiet gap means codex is waiting for input. Then
// paste the seed + Enter to auto-run it. Same reason as attachDraftInjection: a long prompt can't go
// through tmux's new-session command-length limit ("command too long"). Returns a scanner fed the
// pty output.
const CODEX_READY_QUIET_MS = 1000;
const CODEX_AUTORUN_MAX_WAIT_MS = 15_000;
export function attachCodexAutoRun(entry: PtyEntry, prompt: string): (data: string) => void {
  const text = sanitizeDraftText(prompt);
  if (!text) return () => {};
  let done = false;
  let quiet: ReturnType<typeof setTimeout> | null = null;
  const type = () => {
    if (done) return;
    done = true;
    if (quiet) clearTimeout(quiet);
    try {
      entry.term.write(`\x1b[200~${text}\x1b[201~`);
      setTimeout(() => {
        try {
          entry.term.write("\r");
        } catch {
          // pty already gone — nothing to submit
        }
      }, DRAFT_SUBMIT_MS);
    } catch {
      // pty already gone — nothing to type into
    }
  };
  const cap = setTimeout(type, CODEX_AUTORUN_MAX_WAIT_MS);
  return () => {
    if (done) return;
    if (quiet) clearTimeout(quiet);
    quiet = setTimeout(() => {
      clearTimeout(cap);
      type();
    }, CODEX_READY_QUIET_MS);
  };
}
