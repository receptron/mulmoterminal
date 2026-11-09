// @vitest-environment node
import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { appendProbeScreen, classifyProbeStall, probeScreenFile, readableScreen, writeProbeScreen, PROBE_SCREEN_TAIL_CHARS } from "./probe-stall";

const ESC = "\u001b";

// Taken from a real `claude` TUI opening in an untrusted directory, escapes included. The point of
// keeping it verbatim is the SHAPE: a terminal draws the gaps between words by moving the cursor,
// so "I trust this folder" never arrives as those bytes and a plain-text match finds nothing.
const TRUST_SCREEN =
  `${ESC}[2J${ESC}[HAccessing${ESC}[10Cworkspace:\n/tmp/somewhere\n` +
  `Quick${ESC}[6Csafety${ESC}[7Ccheck:${ESC}[7CIs${ESC}[3Cthis${ESC}[5Ca${ESC}[2Cproject${ESC}[8Cyou${ESC}[4Ccreated${ESC}[8Cor${ESC}[3Cone${ESC}[4Cyou${ESC}[4Ctrust?\n` +
  `${ESC}[1m❯${ESC}[0m 1.${ESC}[3CYes,${ESC}[5CI${ESC}[2Ctrust${ESC}[6Cthis${ESC}[5Cfolder\n2. No, exit\nEnter to confirm · Esc to cancel`;

// One ordinary boot, answered. Nothing here may be read as a dialog.
const RUNNING_SCREEN = `${ESC}[2J${ESC}[HClaude Code v2.1.220\n${ESC}[2m❯ reply with the single character: .${ESC}[0m\n⏺ .\n`;

// Recorded from a real `claude` (2.1.284) on a subscription that was out of its week (#2919), escapes
// included — trimmed to the reply and the line after it.
const USAGE_LIMIT_SCREEN =
  `${ESC}[H\r${ESC}[7B${ESC}[38;5;246m  ⎿  ${ESC}[38;5;211mYou've hit your weekly limit · resets Oct 9 at 7am (Asia/Tokyo)\r` +
  `${ESC}[2B${ESC}[38;5;246m✻${ESC}[3GBaked for 4s · done 5:56 PM\r${ESC}[2B${ESC}[48;5;237m❯ ${ESC}[38;5;231m/rate-limit-options${ESC}[39m`;

describe("classifyProbeStall on a usage limit (#2919)", () => {
  it("names the limit when Claude Code says the subscription is out of a window", () => {
    expect(classifyProbeStall(USAGE_LIMIT_SCREEN)).toBe("usage-limit");
  });

  it.each([["You've hit your session limit · resets 11:20am"], ["You've hit your limit · resets 11:20am"], ["You’ve hit your weekly limit"]])(
    "reads %j as a limit too",
    (line) => {
      expect(classifyProbeStall(`${ESC}[2J${line}`)).toBe("usage-limit");
    },
  );

  it("does not read the words 'rate limit' anywhere else as one", () => {
    expect(classifyProbeStall(`${ESC}[2J❯ /rate-limit-options\nexplain the rate limit gauge`)).toBe("unknown");
  });

  it("still names the trust dialog first", () => {
    expect(classifyProbeStall(`${USAGE_LIMIT_SCREEN}${TRUST_SCREEN}`)).toBe("trust-prompt");
  });
});

// Recorded from a real `claude` (2.1.292) on a login whose organization has disabled subscription
// access for Claude Code (#3291), escapes included — the reply and the line after it.
const SUBSCRIPTION_DISABLED_SCREEN =
  `${ESC}[H\r${ESC}[15B${ESC}[38;5;137m⏺${ESC}[3GYour organization has disabled Claude subscription access for Claude Code · Use an Anthropic API key instead, ` +
  `\r${ESC}[2C${ESC}[1Bor ask your admin to enable access\r${ESC}[2B${ESC}[38;5;241m✻${ESC}[3GCooked for 1s · done 8:31 AM`;

describe("classifyProbeStall on disabled subscription access (#3291)", () => {
  it("names it when Claude Code says the organization has disabled it", () => {
    expect(classifyProbeStall(SUBSCRIPTION_DISABLED_SCREEN)).toBe("subscription-disabled");
  });

  it("does not read a mention of an organization or a subscription alone as one", () => {
    expect(classifyProbeStall(`${ESC}[2J❯ explain how my organization's Claude subscription works`)).toBe("unknown");
  });

  it("still names the trust dialog first", () => {
    expect(classifyProbeStall(`${SUBSCRIPTION_DISABLED_SCREEN}${TRUST_SCREEN}`)).toBe("trust-prompt");
  });
});

describe("classifyProbeStall", () => {
  it("names the trust dialog when it is what the terminal is showing", () => {
    expect(classifyProbeStall(TRUST_SCREEN)).toBe("trust-prompt");
  });

  it("names nothing for a session that simply ran", () => {
    expect(classifyProbeStall(RUNNING_SCREEN)).toBe("unknown");
  });

  it("names nothing for an empty screen", () => {
    expect(classifyProbeStall("")).toBe("unknown");
  });

  // A dialog that was ANSWERED repaints with the whole screen drawn after it. Reading that as an
  // open dialog would tell a user to go accept a prompt that is not there.
  it("names nothing once a whole screen has been painted over the dialog", () => {
    expect(classifyProbeStall(TRUST_SCREEN + RUNNING_SCREEN.repeat(4))).toBe("unknown");
  });
});

describe("appendProbeScreen", () => {
  it("keeps what arrived, in order", () => {
    expect(appendProbeScreen(appendProbeScreen("", "boot"), "ing")).toBe("booting");
  });

  // The END is what explains a stall: whatever the terminal was showing when the probe gave up.
  it("keeps the end once the tail is full", () => {
    const held = appendProbeScreen("x".repeat(PROBE_SCREEN_TAIL_CHARS), "TAIL");
    expect(held).toHaveLength(PROBE_SCREEN_TAIL_CHARS);
    expect(held.endsWith("TAIL")).toBe(true);
  });
});

// The file exists to be READ by whoever asks "why is usage n/a", and a TUI writes neither rows nor
// spaces — it moves the cursor. Stripped alone, a real probe screen came out as one 16,000-character
// line with every word run together.
describe("readableScreen", () => {
  it("puts the rows back where the terminal moved the cursor to them", () => {
    expect(readableScreen(TRUST_SCREEN).split("\n")).toContain("❯ 1. Yes, I trust this folder");
  });

  it("puts a space back where the terminal skipped along a row", () => {
    expect(readableScreen(`a${ESC}[4Cb`)).toBe("a b");
  });

  it("collapses the empty rows a repaint leaves behind", () => {
    expect(readableScreen(`a${ESC}[H${ESC}[H${ESC}[H${ESC}[Hb`)).toBe("a\n\nb");
  });
});

describe("writeProbeScreen", () => {
  it("writes the screen as readable text, owner-only", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "mt-probe-stall-"));
    try {
      const file = writeProbeScreen(dir, TRUST_SCREEN);
      expect(file).toBe(probeScreenFile(dir));
      const written = readFileSync(probeScreenFile(dir), "utf8");
      expect(written).toContain("Yes,");
      expect(written).not.toContain(ESC);
      expect(written.split("\n").length).toBeGreaterThan(1);
      // Windows has no POSIX mode bits to check; everywhere else the file is the probe's terminal
      // and belongs to nobody but its owner.
      if (process.platform !== "win32") expect(statSync(probeScreenFile(dir)).mode & 0o777).toBe(0o600);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // Diagnostics must never be the thing that breaks a probe: a state directory that cannot be
  // written costs nothing.
  //
  // Made unwritable by putting a FILE where the directory would have to go, which fails on every
  // platform. `/dev/null/…` reads as the same test and is not one — on Windows that path means
  // nothing in particular and the write can succeed (CodeRabbit review).
  it("answers null rather than throwing when the directory cannot be made", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "mt-probe-stall-"));
    try {
      writeFileSync(path.join(dir, "occupied"), "");
      expect(writeProbeScreen(path.join(dir, "occupied", "state"), "screen")).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
