// What a rate-limit probe's own terminal says about why it never answered (#1293).
//
// A probe that brings nothing back used to leave the reader with "the last check got no answer",
// which is true and useless: the reasons want completely different actions, and telling them apart
// cost a reporter a whole debugging session. The probe already HAS the evidence on its screen —
// this reads it.
//
// Only causes whose words were recorded from a real claude are named, and that is deliberate: a
// guess at a message ("log in again") would be a string nobody here has watched upstream emit, and a
// confidently wrong reason is worse than none. Everything else stays `unknown` and keeps its screen
// instead — see writeProbeScreen.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ESC, squashForMarker, stripPtyEscapes, trustDialogIsUp } from "../../session/pty/pty-scan.js";

/** Why a probe went silent, as far as its own screen can prove. */
export type ProbeStall = "trust-prompt" | "usage-limit" | "subscription-disabled" | "unknown";

// How much of the probe's output to keep. The pty is 120x30, so this holds a few full repaints —
// enough that a dialog painted at startup is still there when the probe gives up 90 seconds later,
// and bounded so a chatty TUI cannot grow it without limit.
export const PROBE_SCREEN_TAIL_CHARS = 16_000;

/** Add a read to a bounded tail, keeping the END: whatever the terminal was showing when the probe
 *  gave up is what explains it. Raw, so an escape split across two reads still strips correctly
 *  once its second half arrives. */
export const appendProbeScreen = (held: string, chunk: string): string => (held + chunk).slice(-PROBE_SCREEN_TAIL_CHARS);

/** What the screen proves, or `unknown` when it proves nothing. */
// Claude Code's own words when a subscription is out of a window, as it puts them in the transcript
// and on screen: "You've hit your weekly limit", "… your session limit", "… your limit" (#2919). The
// probe then never gets a status line, because the block comes before any response.
const USAGE_LIMIT_MARKER = /you['’]vehityour(?:weekly|session)?limit/u;
// Claude Code's reply on a login whose organization does not let its subscription run Claude Code
// (2.1.292, recorded in the TUI and in `-p`). Unlike a usage limit it has no reset to wait for.
const SUBSCRIPTION_DISABLED_MARKER = /yourorganizationhasdisabledclaudesubscriptionaccess/u;

/** Why a probe's terminal never reported, read off what it showed. */
export function classifyProbeStall(screen: string): ProbeStall {
  const squashed = squashForMarker(screen);
  if (trustDialogIsUp(squashed)) return "trust-prompt";
  if (USAGE_LIMIT_MARKER.test(squashed)) return "usage-limit";
  return SUBSCRIPTION_DISABLED_MARKER.test(squashed) ? "subscription-disabled" : "unknown";
}

// A TUI does not write rows and spaces — it MOVES THE CURSOR — so a stream with its escapes merely
// stripped is one unreadable 16,000-character line with every word run together. Measured on real
// probes. Enough of the movement is put back for a person to read the file this exists to give
// them: the sequences that start a row (CUP `ESC[…H` / `ESC[…f`, next-line `ESC[…E`, cursor-down
// `ESC[…B`) become breaks, and the ones that skip along a row (`ESC[…C`, `ESC[…G`) become a space.
//
// Not terminal emulation and not trying to be: nothing downstream parses this, and a row landing in
// the wrong place costs a reader nothing. The marker matching that DOES decide something goes
// through squashForMarker instead, which needs no such reconstruction.
const ROW_BREAKS = new RegExp(`${ESC}\\[[0-9;]*[HfEB]`, "gu");
const COLUMN_GAPS = new RegExp(`${ESC}\\[[0-9;]*[CG]`, "gu");
// Repainting the same screen leaves runs of empty rows behind it.
const BLANK_RUN = /\n{3,}/gu;

/** The screen as a person would read it: rows where the terminal had rows, escapes gone. */
export const readableScreen = (screen: string): string =>
  stripPtyEscapes(screen.replace(ROW_BREAKS, "\n").replace(COLUMN_GAPS, " ")).replace(BLANK_RUN, "\n\n");

/** Where the last unexplained probe screen is kept. One file, overwritten: the question it answers
 *  is always "why is the gauge n/a NOW", and a directory of old screens is a log nobody prunes. */
export const probeScreenFile = (stateDir: string): string => path.join(stateDir, "probe-last-screen.txt");

/** Keep the screen of a probe that failed for a reason we cannot name, so the next person asking
 *  "why is usage n/a" has the terminal in front of them instead of a guess. It is the probe's own
 *  hidden session, never a user's.
 *
 *  Returns the path written, or null when it could not be — this is diagnostics, so a read-only
 *  state directory must cost nothing. */
export function writeProbeScreen(stateDir: string, screen: string): string | null {
  const file = probeScreenFile(stateDir);
  try {
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(file, readableScreen(screen), { mode: 0o600 });
    return file;
  } catch {
    return null;
  }
}
