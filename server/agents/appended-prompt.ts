// What a spawned session's `--append-system-prompt` carries (#1062). The two sections are
// independent settings — the closing summary is `appendSystemPrompt`, the PR clone line is
// `prWorkdirFooter` — so switching one off must leave the other alone.
//
// One place decides the whole text, rather than the argv builder assembling it: the setting is
// specified as off / preset / a user's own wording, and only the preset arm ships today. When the
// custom arm lands it widens the two `…Setting` fields here and nothing else moves.
//
// The directory-over-global precedence lives here too, and not at the spawn: that is the rule a
// bug would hide in, and the spawn body cannot be reached from a test without a PTY.
import { SESSION_SUMMARY_PROMPT } from "./session-summary-prompt.js";
import { prClonePrompt } from "./pr-clone-prompt.js";

/** `dirSetting` is the directory's `.mulmoterminal.json` answer, null when it did not give one, in
 *  which case `globalSetting` decides. True takes the built-in preset, false leaves the summary
 *  out; a user-supplied string is the planned third value (see
 *  plans/feat-1062-append-system-prompt.md for the sanitizing it needs first). Returns null when
 *  neither section applies — the caller then passes no flag at all, rather than an empty string
 *  the CLI would still have to parse. */
export function appendedSystemPrompt(input: { dirSetting: boolean | null; globalSetting: boolean; workdirFooter: string | null }): string | null {
  const summary = input.dirSetting ?? input.globalSetting;
  const sections = [summary ? SESSION_SUMMARY_PROMPT : null, input.workdirFooter ? prClonePrompt(input.workdirFooter) : null].filter(
    (section): section is string => section !== null,
  );
  // One flag, both sections: `--append-system-prompt` given twice would leave which one wins up
  // to the CLI, and the two texts are independent enough to simply concatenate.
  return sections.length ? sections.join("\n\n") : null;
}
