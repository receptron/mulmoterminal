// The prompt for a session that changes the spec on a person's word, while the build waits at the
// spec's review gate. The conversation so far goes in whole: each message gets a fresh session, and
// it must not undo what an earlier one agreed.
import type { BlueprintRun } from "./run.js";

export const SPEC_FILE = ".blueprint/spec.md";
export const OPEN_QUESTIONS_FILE = ".blueprint/open-questions.md";
// One reply file per session: a session that was given up on and writes late cannot land its words
// in the next message's reply.
export const replyFile = (sessionId: string): string => `.blueprint/reply-${sessionId}.md`;

type ChatEntry = BlueprintRun["specChat"][number];

const transcript = (chat: readonly ChatEntry[]): string[] =>
  chat.length === 0 ? [] : ["", "The conversation so far:", ...chat.map((entry) => `${entry.role === "person" ? "User" : "You"}: ${entry.text}`)];

export function specRevisionPrompt(input: {
  chat: readonly ChatEntry[];
  message: string;
  packDirs: { base: string; usecase: string };
  replyPath: string;
}): string {
  return [
    "You are refining the specification of an app with its owner, BEFORE anything is built.",
    `The spec is ${SPEC_FILE}; undecided points are in ${OPEN_QUESTIONS_FILE}; the interview answers are in .blueprint/answers.json.`,
    `Base pack: ${input.packDirs.base}. Usecase pack: ${input.packDirs.usecase}.`,
    ...transcript(input.chat),
    "",
    `The user now says: ${input.message}`,
    "",
    `1. Change ${SPEC_FILE} (and ${OPEN_QUESTIONS_FILE}) to reflect it. Keep the document's structure; mark your own proposals （提案）; remove a point from the open questions once it is decided. Keep the first version small: what the user asks for, nothing more.`,
    "2. Do not build anything and do not touch any other file.",
    `3. Write your reply to the user in ${input.replyPath}: in the user's language, short — what you changed, and anything you need them to decide.`,
    "4. Stop.",
  ].join("\n");
}
