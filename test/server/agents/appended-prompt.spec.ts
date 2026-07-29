import { describe, it, expect } from "vitest";
import { appendedSystemPrompt } from "../../../server/agents/appended-prompt.js";
import { SESSION_SUMMARY_PROMPT } from "../../../server/agents/session-summary-prompt.js";

const FOOTER = "work in myrepo3";
const on = (over: Partial<Parameters<typeof appendedSystemPrompt>[0]> = {}) =>
  appendedSystemPrompt({ dirSetting: null, globalSetting: true, workdirFooter: null, ...over });

// #1062. The two sections are separate settings — `appendSystemPrompt` and `prWorkdirFooter` —
// so all four combinations have to be reachable, and switching one off must leave the other. The
// off/off case is the one worth pinning: it must be null, not an empty string, so the caller drops
// the flag rather than passing a value the CLI still has to parse.
describe("appendedSystemPrompt", () => {
  it("preset + footer: both sections, summary first, separated by a blank line", () => {
    expect(on({ workdirFooter: FOOTER })).toBe(`${SESSION_SUMMARY_PROMPT}\n\n## Which clone this work is in\n\n${footerSection(FOOTER)}`);
  });

  it("preset alone when the directory is not a repo / the footer is switched off", () => {
    expect(on()).toBe(SESSION_SUMMARY_PROMPT);
  });

  // The point of the opt-out: the closing-summary instruction goes, and a PR opened here still
  // says which clone it came from.
  it("footer alone when the summary is switched off", () => {
    const text = on({ globalSetting: false, workdirFooter: FOOTER });
    expect(text).not.toContain("Closing summary");
    expect(text).toContain(FOOTER);
  });

  it("null when neither section applies", () => {
    expect(on({ globalSetting: false })).toBeNull();
  });

  // Same Windows argv constraint the two prompt modules are written under (#813): nothing claude
  // is launched with may carry a quote for a `.cmd` parser to trip over. Asserted on the JOIN too,
  // because that is the string that actually reaches the spawn.
  it.each([
    ["preset + footer", true, FOOTER],
    ["footer alone", false, FOOTER],
    ["preset alone", true, null],
  ])("contains no ASCII double quote (%s)", (_case, globalSetting, workdirFooter) => {
    expect(on({ globalSetting, workdirFooter })).not.toContain(String.fromCharCode(34));
  });
});

// A directory's `.mulmoterminal.json` decides for its own sessions; null there — the usual case —
// means it said nothing, which is NOT the same as saying `false`.
describe("directory over global", () => {
  const hasSummary = (dirSetting: boolean | null, globalSetting: boolean) => (on({ dirSetting, globalSetting }) ?? "").includes("Closing summary");

  it.each([
    ["the directory switches it off against a global on", false, true, false],
    ["the directory switches it on against a global off", true, false, true],
    ["the directory says nothing and the global is on", null, true, true],
    ["the directory says nothing and the global is off", null, false, false],
  ])("%s", (_case, dirSetting, globalSetting, expected) => {
    expect(hasSummary(dirSetting, globalSetting)).toBe(expected);
  });
});

// The footer prompt's own body, restated here rather than imported, so a reworded prClonePrompt
// has to be looked at instead of silently agreeing with itself.
function footerSection(footer: string): string {
  return [
    "When you open a pull request for this repository — with gh, the API, or any other tool — end the",
    "body with this line, on its own:",
    "",
    footer,
    "",
    "Several checkouts of one repository run side by side here, and a PR on GitHub otherwise carries",
    "nothing that says which one produced it. Take the line exactly as given above; do not derive the",
    "name from the branch, the path, or the working directory. Add it once — if the body already ends",
    "with that line, leave it as it is.",
  ].join("\n");
}
