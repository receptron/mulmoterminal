// @vitest-environment node
// What attachDraftInjection actually WRITES to the pty: the framing, the guard space that keeps a
// completion menu from eating the submit, and the submit byte(s) themselves — which are the host's
// `terminalSubmit` mapping, not a hardcoded CR (#1148).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { attachDraftInjection } from "../../../server/session/draft-injection.js";
import type { SessionAgent } from "../../../common/sessionAgent.js";

const PASTE_START = "\x1b[200~";
const PASTE_END = "\x1b[201~";
const CR = "\r";
const ESC_CR = "\x1b\r";
// Matches DRAFT_SUBMIT_MS / DRAFT_SETTLE_MS / DRAFT_QUIET_MS / TRUST_QUIET_MS in draft-injection.ts.
const SUBMIT_MS = 150;
const SETTLE_MS = 250;
// The quiet window the drift fallback waits for. Named FALLBACK_MS from when it measured elapsed
// time since the spawn rather than silence.
const FALLBACK_MS = 6000;
const TRUST_QUIET_MS = 60_000;

// What claude prints once its input box is up — the marker the scanner waits for.
const READY = "shift+tab to cycle";

const target = (agent: SessionAgent = "claude") => {
  const writes: string[] = [];
  return {
    writes,
    entry: {
      agent,
      term: {
        write: (data: string) => {
          writes.push(data);
          return true;
        },
      },
    },
  };
};

// Drive a session from spawn to submitted: feed the readiness marker, then let both timers run.
const typeAndSubmit = (scan: (data: string) => void) => {
  scan(READY);
  vi.advanceTimersByTime(SETTLE_MS);
  vi.advanceTimersByTime(SUBMIT_MS);
};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("attachDraftInjection", () => {
  it("submits an initialPrompt with the host's ESC+CR, in a write of its own", () => {
    const t = target();
    typeAndSubmit(attachDraftInjection(t.entry, "run me", undefined, () => ESC_CR));
    // Two writes, never one: a submit glued to the paste can arrive before the TUI has
    // committed it and be dropped, leaving the prompt typed-but-unsent.
    expect(t.writes).toEqual([`${PASTE_START}run me ${PASTE_END}`, ESC_CR]);
  });

  it("submits with a plain CR on a default host", () => {
    const t = target();
    typeAndSubmit(attachDraftInjection(t.entry, "run me", undefined, () => CR));
    expect(t.writes).toEqual([`${PASTE_START}run me ${PASTE_END}`, CR]);
  });

  it("waits DRAFT_SUBMIT_MS before submitting", () => {
    const t = target();
    const scan = attachDraftInjection(t.entry, "run me", undefined, () => ESC_CR);
    scan(READY);
    vi.advanceTimersByTime(SETTLE_MS);
    expect(t.writes).toHaveLength(1);
    vi.advanceTimersByTime(SUBMIT_MS - 1);
    expect(t.writes).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(t.writes[1]).toBe(ESC_CR);
  });

  // Read when the submit fires, not when the session is attached, so editing `terminalSubmit`
  // takes effect on the next spawn's submit without a server restart.
  it("resolves the submit sequence at submit time, not at attach time", () => {
    const t = target();
    let mode = CR;
    const scan = attachDraftInjection(t.entry, "run me", undefined, () => mode);
    scan(READY);
    vi.advanceTimersByTime(SETTLE_MS);
    mode = ESC_CR;
    vi.advanceTimersByTime(SUBMIT_MS);
    expect(t.writes[1]).toBe(ESC_CR);
  });

  // The reported repro: a Skill launch seeds `/<slug>`, whose completion menu eats the submit
  // unless the token is ended. The space must be INSIDE the paste — after the terminator it
  // would be a keystroke, which is what an open menu reads.
  it("ends a `/command` auto-run inside the paste so no menu holds the submit", () => {
    const t = target();
    typeAndSubmit(attachDraftInjection(t.entry, "/mulmoterminal-dirs", undefined, () => ESC_CR));
    expect(t.writes[0]).toBe(`${PASTE_START}/mulmoterminal-dirs ${PASTE_END}`);
    expect(t.writes[0].split(PASTE_START)).toHaveLength(2);
    expect(t.writes[0].split(PASTE_END)).toHaveLength(2);
  });

  it("adds exactly one space, and none to text that already ends in one", () => {
    const t = target();
    typeAndSubmit(attachDraftInjection(t.entry, "run me ", undefined, () => CR));
    expect(t.writes[0]).toBe(`${PASTE_START}run me ${PASTE_END}`);
  });

  // A draft is handed over for review — no submit, and its bytes stay exactly what was passed in:
  // the guard is for text we submit on the user's behalf, and their own Enter can be retried.
  it("neither guards nor submits a draft", () => {
    const t = target();
    const scan = attachDraftInjection(t.entry, undefined, "edit me", () => ESC_CR);
    scan(READY);
    vi.advanceTimersByTime(SETTLE_MS + SUBMIT_MS + FALLBACK_MS);
    expect(t.writes).toEqual([`${PASTE_START}edit me${PASTE_END}`]);
  });

  // The scoping both behaviours share: `terminalSubmit` and the completion menu are Claude Code's,
  // so any other agent keeps plain CR and byte-exact text (a trailing space is real input to a
  // shell — `echo foo\` waits for more, `echo foo\ ` runs).
  it("leaves a non-claude session's bytes exactly as given", () => {
    const t = target("shell");
    typeAndSubmit(attachDraftInjection(t.entry, "echo foo\\", undefined, () => CR));
    expect(t.writes).toEqual([`${PASTE_START}echo foo\\${PASTE_END}`, CR]);
  });

  it("types nothing before the input box has painted", () => {
    const t = target();
    const scan = attachDraftInjection(t.entry, "run me", undefined, () => CR);
    scan("booting up");
    vi.advanceTimersByTime(SETTLE_MS + SUBMIT_MS);
    expect(t.writes).toEqual([]);
  });

  // The marker is a UI string that can drift; the fallback is what keeps a spawn from hanging
  // silently when it does.
  it("types and submits on the fallback when the marker never paints", () => {
    const t = target();
    attachDraftInjection(t.entry, "run me", undefined, () => ESC_CR);
    vi.advanceTimersByTime(FALLBACK_MS);
    vi.advanceTimersByTime(SUBMIT_MS);
    expect(t.writes).toEqual([`${PASTE_START}run me ${PASTE_END}`, ESC_CR]);
  });

  it("types once when the marker paints and the fallback also comes due", () => {
    const t = target();
    const scan = attachDraftInjection(t.entry, "run me", undefined, () => ESC_CR);
    typeAndSubmit(scan);
    vi.advanceTimersByTime(FALLBACK_MS);
    expect(t.writes).toEqual([`${PASTE_START}run me ${PASTE_END}`, ESC_CR]);
  });

  it("writes nothing when there is neither a prompt nor a draft", () => {
    const t = target();
    const scan = attachDraftInjection(t.entry, undefined, undefined, () => CR);
    scan(READY);
    vi.advanceTimersByTime(FALLBACK_MS + SETTLE_MS + SUBMIT_MS);
    expect(t.writes).toEqual([]);
  });

  // All of these come from driving the real flow in a worktree the app had just created and
  // reading the pane with `tmux capture-pane`. Every one of them passed unit tests while the
  // feature silently dropped the seed.
  describe("a directory claude has not seen (#1173)", () => {
    const TRUST = "Is this a project you created or one you trust?\n 1. Yes, I trust this folder";

    // The bug that made every attempt look identical: claude in a fresh worktree takes longer to
    // reach any input box than one fixed window, so a since-spawn fallback typed into a
    // half-drawn screen and marked itself done. The draft was gone before there was anywhere to
    // put it.
    it("does not type while the screen is still being drawn", () => {
      const t = target();
      const scan = attachDraftInjection(t.entry, undefined, "edit me", () => ESC_CR);
      // A booting TUI streams continuously; each burst pushes the wait out.
      for (let elapsed = 0; elapsed < FALLBACK_MS * 3; elapsed += FALLBACK_MS / 2) {
        scan("still drawing");
        vi.advanceTimersByTime(FALLBACK_MS / 2);
      }
      expect(t.writes).toEqual([]);
    });

    it("holds the draft while the trust dialog is up, far past the normal window", () => {
      const t = target();
      const scan = attachDraftInjection(t.entry, undefined, "edit me", () => ESC_CR);
      scan(TRUST);
      // Nothing more paints until the user answers, so the normal quiet window must not make it
      // type — this is the one quiet screen that is not readiness.
      vi.advanceTimersByTime(FALLBACK_MS * 5);
      expect(t.writes).toEqual([]);
    });

    // Long, not forever. The stream cannot prove the dialog is gone — answering it repaints the
    // dialog and the new screen in one burst and then output stops — so a scanner that held out
    // for proof never typed at all. Bounded degradation beats a draft that is silently dropped.
    it("gives up holding after the long window, rather than never typing", () => {
      const t = target();
      const scan = attachDraftInjection(t.entry, undefined, "edit me", () => ESC_CR);
      scan(TRUST);
      vi.advanceTimersByTime(TRUST_QUIET_MS);
      expect(t.writes).toEqual([`${PASTE_START}edit me${PASTE_END}`]);
    });

    it("types once the dialog is answered and the input box paints", () => {
      const t = target();
      const scan = attachDraftInjection(t.entry, undefined, "edit me", () => ESC_CR);
      scan(TRUST);
      vi.advanceTimersByTime(FALLBACK_MS * 5);
      // Answering repaints, and the repaint carries the status line — so the draft goes in on the
      // marker rather than on a further quiet window.
      scan("manual mode on · ? for shortcuts");
      vi.advanceTimersByTime(SETTLE_MS);
      expect(t.writes).toEqual([`${PASTE_START}edit me${PASTE_END}`]);
    });

    // The bytes above, as a terminal actually sends them. Both markers reach the scanner with
    // cursor moves BETWEEN their words, which is what made the spaced regexes match nothing:
    // readiness was never seen (every spawn paid the full quiet window) and the dialog was held
    // through only because its screen happens to be quiet too.
    it("recognizes both markers through the cursor moves a redraw puts between the words", () => {
      const t = target();
      const scan = attachDraftInjection(t.entry, undefined, "edit me", () => ESC_CR);
      scan(
        `\u001b[2GQuick\u001b[8Gsafety\u001b[15Gcheck:\u001b[22GIs\u001b[25Gthis\u001b[30Ga\u001b[32Gproject\u001b[40Gyou\u001b[44Gcreated\u001b[52Gor\u001b[55Gone\u001b[59Gyou\u001b[63Gtrust?`,
      );
      vi.advanceTimersByTime(FALLBACK_MS * 5);
      expect(t.writes).toEqual([]);
      scan(`\u001b[3G⏸\u001b[5Gmanual\u001b[12Gmode\u001b[17Gon\u001b[20G·\u001b[22G?\u001b[24Gfor\u001b[28Gshortcuts`);
      vi.advanceTimersByTime(SETTLE_MS);
      expect(t.writes).toEqual([`${PASTE_START}edit me${PASTE_END}`]);
    });

    // The marker still wins when it does appear: it means the input box exists, so there is no
    // reason to sit through the quiet window.
    it("types on the marker even in the same burst that repaints the answered dialog", () => {
      const t = target();
      const scan = attachDraftInjection(t.entry, undefined, "edit me", () => ESC_CR);
      scan(TRUST);
      scan(`${TRUST}\n\n${READY}`);
      vi.advanceTimersByTime(SETTLE_MS);
      expect(t.writes).toEqual([`${PASTE_START}edit me${PASTE_END}`]);
    });
  });
});
