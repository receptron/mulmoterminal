// @vitest-environment node
import { describe, it, expect } from "vitest";

import { parseStyledRows, rowsToScreen, suggestionFromRows } from "../../../server/session/screen-rows.js";

const ESC = String.fromCharCode(0x1b);
const NBSP = String.fromCharCode(0xa0);

// Captured verbatim from `tmux capture-pane -p -e` against a pane painted to mimic
// Claude Code's TUI: 256-colour hints, an OSC 8 hyperlink, a dim ghost suggestion in the
// input box, and the 38;5;2 trap (green, whose trailing 2 is NOT the dim attribute).
const STYLED = [
  `${ESC}[38;5;241m⏺${ESC}[39m ${ESC}[38;5;2mgreen 38;5;2 must not read as dim${ESC}[39m`,
  `  ${ESC}]8;id=1;https://github.com/receptron/mulmoterminal/pull/563${ESC}\\PR #563${ESC}]8;;${ESC}\\`,
  `${ESC}[2mdimmed prose that is not the input box${ESC}[0m`,
  `${ESC}[38;5;246m────────────────────────────${ESC}[39m`,
  `❯ ${ESC}[2mmilestones に目標を書く${ESC}[0m`,
  `${ESC}[38;5;246m────────────────────────────${ESC}[39m`,
  `  ${ESC}[38;5;137m⏵⏵ auto mode on${ESC}[38;5;241m (shift+tab to cycle)${ESC}[39m`,
].join("\n");

// The same pane read with `tmux capture-pane -p` — what the phone used to receive, and
// must keep receiving now that the host captures with `-e` and strips it back out.
const PLAIN = [
  "⏺ green 38;5;2 must not read as dim",
  "  PR #563",
  "dimmed prose that is not the input box",
  "────────────────────────────",
  "❯ milestones に目標を書く",
  "────────────────────────────",
  "  ⏵⏵ auto mode on (shift+tab to cycle)",
].join("\n");

const rowsOf = (...lines: string[]) => parseStyledRows(lines.join("\n"));

describe("rowsToScreen", () => {
  it("reproduces the plain capture of the same pane, byte for byte", () => {
    expect(rowsToScreen(parseStyledRows(STYLED))).toBe(PLAIN);
  });

  it("keeps a screen with no styling at all untouched", () => {
    expect(rowsToScreen(parseStyledRows("plain\n  indented\n"))).toBe("plain\n  indented\n");
  });

  // `-e` keeps the blanks a coloured background painted to the end of the row; plain
  // capture drops them. The phone is shown the plain screen, so these must not leak in.
  it("drops the trailing blanks that -e keeps and -p does not", () => {
    expect(rowsToScreen(parseStyledRows(`${ESC}[48;5;236mRan 2 shell commands   ${ESC}[49m`))).toBe("Ran 2 shell commands");
  });

  // Claude Code draws its empty input box as "❯" + U+00A0. tmux keeps that character in
  // both captures, so a trim wide enough to eat it would rewrite the screen the phone
  // has always been shown.
  it("keeps the no-break space an empty input box is drawn with", () => {
    expect(rowsToScreen(parseStyledRows(`${ESC}[38;5;241m❯${NBSP}${ESC}[39m`))).toBe(`❯${NBSP}`);
  });
});

describe("parseStyledRows", () => {
  it("collects the dim run beside the row's text", () => {
    expect(rowsOf(`❯ ${ESC}[2mghost${ESC}[0m`)).toEqual([{ text: "❯ ghost", dim: "ghost" }]);
  });

  it("leaves dim empty on an unstyled row", () => {
    expect(rowsOf("nothing dim here")).toEqual([{ text: "nothing dim here", dim: "" }]);
  });

  // 22 turns off bold/dim without resetting colour; 0 resets everything. Both end the run.
  it("ends the run on either reset", () => {
    expect(rowsOf(`${ESC}[2mdim${ESC}[22m after`)[0].dim).toBe("dim");
    expect(rowsOf(`${ESC}[2mdim${ESC}[0m after`)[0].dim).toBe("dim");
    expect(rowsOf(`${ESC}[2mdim${ESC}[m after`)[0].dim).toBe("dim");
  });

  // The trailing 2 of an extended colour is an argument, not the dim attribute — reading
  // it as dim would mark the whole rest of the line as ghost text.
  it("does not read an extended colour's arguments as attributes", () => {
    expect(rowsOf(`${ESC}[38;5;2mgreen`)[0].dim).toBe("");
    expect(rowsOf(`${ESC}[38;2;1;2;3mtruecolor`)[0].dim).toBe("");
    expect(rowsOf(`${ESC}[48;5;2mon green`)[0].dim).toBe("");
  });

  it("still sees dim when it rides along with a colour", () => {
    expect(rowsOf(`${ESC}[2;38;5;241mboth`)[0].dim).toBe("both");
  });

  // tmux re-emits hyperlinks with -e; they carry no attribute and no text.
  it("drops OSC hyperlinks without dropping their label", () => {
    expect(rowsOf(`${ESC}]8;;https://example.com${ESC}\\label${ESC}]8;;${ESC}\\`)).toEqual([{ text: "label", dim: "" }]);
  });

  it("handles an empty screen", () => {
    expect(parseStyledRows("")).toEqual([{ text: "", dim: "" }]);
  });

  // Attributes do not survive a line break in a capture — tmux re-states them per row.
  it("starts each row with the attributes reset", () => {
    expect(rowsOf(`${ESC}[2mdim`, "next row").map((row) => row.dim)).toEqual(["dim", ""]);
  });
});

describe("suggestionFromRows", () => {
  it("reads the ghost text out of a real screen", () => {
    expect(suggestionFromRows(parseStyledRows(STYLED))).toBe("milestones に目標を書く");
  });

  // The whole point of carrying dim: text the user typed looks identical once colour is
  // gone, and offering it back would double it when the phone pastes.
  it("ignores a draft the user typed", () => {
    expect(suggestionFromRows(rowsOf("❯ half a sentence I typed"))).toBe("");
  });

  it("says nothing about an empty input box", () => {
    expect(suggestionFromRows(rowsOf("❯ "))).toBe("");
  });

  // Dim is used for hints and diff gutters all over an agent's output; only the input
  // box's caret marks a suggestion.
  it("ignores dim text that is not in the input box", () => {
    expect(suggestionFromRows(rowsOf(`${ESC}[2m 19   const x = 1;${ESC}[0m`))).toBe("");
  });

  // Half-dim means the user is typing over the ghost, so there is nothing whole to offer.
  it("ignores a row that is only partly dim", () => {
    expect(suggestionFromRows(rowsOf(`❯ typed ${ESC}[2mghost${ESC}[0m`))).toBe("");
  });

  // Scrollback keeps old prompts above the live one.
  it("takes the last box on the screen", () => {
    const rows = rowsOf(`❯ ${ESC}[2mold idea${ESC}[0m`, "some output", `❯ ${ESC}[2mnew idea${ESC}[0m`);
    expect(suggestionFromRows(rows)).toBe("new idea");
  });

  // The box wraps the ghost text itself, so the break ate the space between two words.
  it("rejoins a suggestion wrapped across rows", () => {
    const rows = rowsOf(`❯ ${ESC}[2madd tests for the${ESC}[0m`, `  ${ESC}[2mnew parser${ESC}[0m`);
    expect(suggestionFromRows(rows)).toBe("add tests for the new parser");
  });

  // Japanese wraps mid-phrase with no space to restore — inserting one would corrupt it.
  it("rejoins a wrapped Japanese suggestion without inventing a space", () => {
    const rows = rowsOf(`❯ ${ESC}[2mmilestones に目標${ESC}[0m`, `  ${ESC}[2mを書く${ESC}[0m`);
    expect(suggestionFromRows(rows)).toBe("milestones に目標を書く");
  });

  it("stops rejoining at the box's bottom rule", () => {
    const rows = rowsOf(`❯ ${ESC}[2mwrite the tests${ESC}[0m`, `${ESC}[38;5;246m────${ESC}[39m`, `${ESC}[2munrelated dim line${ESC}[0m`);
    expect(suggestionFromRows(rows)).toBe("write the tests");
  });

  it("says nothing about a screen with no input box", () => {
    expect(suggestionFromRows(rowsOf("just output", "more output"))).toBe("");
  });
});
