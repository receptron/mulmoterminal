// Getting a prompt INTO an agent's TUI by typing it, rather than passing it as a CLI
// argument — a long prompt overflows tmux's `new-session` command-length limit and kills
// the session. Split from index.ts (#548): the two agents differ only in how they decide
// the input box is ready, and neither decision needs any of index.ts's session state.
import type { IPty } from "node-pty";
import { claudeAdapter } from "../agents/claude.js";
import type { PtyEntry } from "./types.js";
import { sanitizeDraftText } from "./pty-text.js";
import { squashForMarker } from "./pty-scan.js";
import { planDraftInjection } from "./draft-plan.js";
import { submittableLineForAgent } from "../../common/terminalSubmit.js";

// All a session needs to be typed into: where the bytes go, and which agent reads them
// (both the submit mapping and the completion-menu guard are Claude Code's behaviour).
type DraftTarget = Pick<PtyEntry, "agent"> & { term: Pick<IPty, "write"> };

// Claude must have its input box + bracketed-paste mode up before it will capture a
// typed `draft`; too early and the bytes are echoed into the scrollback instead. We
// wait for its status line to paint (the mode hint — "? for shortcuts" on current
// versions), settle briefly, then type. A fallback fires if that marker never shows
// (UI string drift).
//
// Every marker below is matched against the SQUASHED stream, never the raw bytes: a TUI
// redraws by positioning the cursor between words, so the readiness hint reaches us as
// "?ESC[24GforESC[28Gshortcuts" and the trust dialog as "Yes,ESC[12GIESC[14Gtrust…".
// Both were written as spaced regexes over raw data and therefore matched NOTHING — the
// readiness one silently cost every claude spawn the full DRAFT_QUIET_MS below (~10s to a
// visible prompt in a chat started from the collection UI), and the trust guard was
// holding only because a dialog screen is also a quiet one.
const DRAFT_READY_MARKER = claudeAdapter.draftReadyMarker;
const DRAFT_SETTLE_MS = 250;
// The drift fallback waits for the stream to go QUIET for this long, not for this long since the
// spawn. A booting TUI streams continuously, and in a worktree the app has just created claude
// takes longer than one fixed window to reach an input box at all — so a since-spawn timer typed
// into a half-drawn screen, marked itself done, and the draft was gone before the input box
// existed. Same reasoning (and roughly the same shape) as attachCodexAutoRun below, which has
// never had a marker to wait for.
const DRAFT_QUIET_MS = 6000;

// Claude opens on a trust prompt in a directory it has not seen — the state a worktree created
// moments ago starts in, the first time one is made under a repo's managed root (#1173). There is
// no input box behind it, and it is also a QUIET screen, so the window above would read it as
// readiness and paste into the dialog, which discards the text.
//
// So the dialog gets a much longer window instead of the normal one. Long rather than infinite:
// the stream cannot tell whether the dialog is still up — answering it repaints the dialog and the
// new screen together, and then the screen stops changing — so a scanner that waited forever for
// proof would never type at all. Observed doing exactly that.
const TRUST_QUIET_MS = 60_000;
const TRUST_PROMPT_MARKER = /yes,itrustthisfolder|projectyoucreatedoroneyoutrust/;
// Claude's TUI commits a bracketed paste to its input box asynchronously; a CR glued
// onto the same write can arrive before the paste lands and be dropped — leaving an
// auto-run prompt typed-but-unsent. Send the submitting Enter as a SEPARATE chunk a
// beat after the paste so it actually registers.
const DRAFT_SUBMIT_MS = 150;

// Deliver an auto-run prompt (initialPrompt) or an editable draft by TYPING it into
// claude's input box once it's ready — NOT as a `claude` CLI arg, which a large prompt
// would overflow tmux's `new-session` command-length limit with ("command too long",
// killing the session). ALL control bytes are stripped first — C0/C1, including ESC,
// Ctrl-C, CR/LF and an embedded bracketed-paste terminator (\e[201~) — so untrusted text
// (collection / custom-view) can't inject sequences that break out of the paste. It's
// wrapped in bracketed paste (\e[200~…\e[201~); initialPrompt then submits to run it,
// while a draft gets NO submit so the user reviews + sends. Returns a scanner to feed
// the pty output to: it types once the input-box readiness marker paints (after a settle),
// or after DRAFT_FALLBACK_MS if the marker never appears (UI drift). No-op when neither.
//
// `submitSequence` supplies the byte(s) that submit on THIS host — called when the submit
// fires, not when the session is attached, so a `terminalSubmit` edit applies without a
// restart. It is a parameter rather than a config read here because a hardcoded CR is
// exactly the bug this path had (#1148): on an `esc-cr` host CR is the newline, so the
// prompt was typed and never sent.
export function attachDraftInjection(
  entry: DraftTarget,
  initialPrompt: string | undefined,
  draft: string | undefined,
  submitSequence: () => string,
): (data: string) => void {
  const plan = planDraftInjection(initialPrompt, draft, sanitizeDraftText);
  if (!plan) return () => {};
  const { text: draftText, autoSubmit } = plan;
  let done = false;
  let scan = "";
  const typeDraft = () => {
    if (done) return;
    done = true;
    try {
      // Type the paste first; for an auto-run, submit in a SEPARATE write a beat later
      // (DRAFT_SUBMIT_MS) so the Enter isn't dropped while Claude's TUI is still committing
      // the paste. A draft gets no submit — the user reviews + sends.
      //
      // An auto-run line ends in a space (submittableLineForAgent) so no completion menu is
      // open when the submit lands — an open `/command` or `@path` menu eats it (#1142). The
      // space rides INSIDE the paste, where the TUI takes it as text; after the terminator it
      // would be a keystroke, which is exactly what an open menu reads. A draft keeps its text
      // byte-exact: the user's own Enter is a keystroke they can retry once they see the menu.
      const line = autoSubmit ? submittableLineForAgent(entry.agent, draftText) : draftText;
      entry.term.write(`\x1b[200~${line}\x1b[201~`);
      if (autoSubmit) {
        setTimeout(() => {
          try {
            entry.term.write(submitSequence());
          } catch {
            // pty already gone — nothing to submit
          }
        }, DRAFT_SUBMIT_MS);
      }
    } catch {
      // pty already gone — nothing to draft into
    }
  };
  // Fallback: type even if the readiness marker never appears — a further UI string drift, or a
  // status line too narrow for the hint (claude drops it for the context meter in a small pane).
  // Re-armed on every burst below, so it measures silence rather than elapsed time.
  let quiet = setTimeout(typeDraft, DRAFT_QUIET_MS);
  const waitFor = (ms: number) => {
    clearTimeout(quiet);
    quiet = setTimeout(typeDraft, ms);
  };
  return (data: string) => {
    if (done) return;
    // Type the draft once claude's input box has painted (its mode-hint status line),
    // then settle briefly so the paste lands in the input rather than the scrollback.
    // Squashed, not raw: the words of both markers arrive with cursor moves between them. The tail
    // kept is the RAW one, so a sequence split across two reads still squashes correctly once its
    // second half arrives.
    scan = (scan + data).slice(-4096);
    const screen = squashForMarker(scan);
    // Checked before the dialog: answering it repaints the dismissed dialog and the new prompt in
    // ONE burst, and the marker is the stronger fact — it means an input box exists now.
    if (DRAFT_READY_MARKER.test(screen)) {
      scan = "";
      clearTimeout(quiet);
      setTimeout(typeDraft, DRAFT_SETTLE_MS);
      return;
    }
    // The one quiet screen that must not be typed into: hold much longer than usual. `scan` is
    // cleared so a repaint does not keep re-arming the long window forever.
    if (TRUST_PROMPT_MARKER.test(screen)) {
      scan = "";
      waitFor(TRUST_QUIET_MS);
      return;
    }
    waitFor(DRAFT_QUIET_MS);
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
          // Plain CR, not the configured sequence: `terminalSubmit` describes the user's CLAUDE
          // keymap, and every other agent submits on CR (submitSequenceForAgent's rule).
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
