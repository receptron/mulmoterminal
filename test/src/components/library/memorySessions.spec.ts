// Whether a session runs in a project: the boolean the save and trash paths use, and the three-state
// answer the editor uses so that a list that could not be read leaves its warning alone.
import { describe, it, expect, vi } from "vitest";

const listed = vi.hoisted(() => ({ answer: null as { sessions: { runningKey?: string | null }[] } | null }));
vi.mock("../../../../src/composables/useDirLists", () => ({ readResumableList: async () => listed.answer }));

const { sessionRunningIn, sessionRunningOrUnknown } = await import("../../../../src/components/library/memorySessions");

const CASES: { name: string; cwd: string | null; answer: typeof listed.answer; unknown: boolean | null; running: boolean }[] = [
  { name: "no project", cwd: null, answer: { sessions: [{ runningKey: "s" }] }, unknown: false, running: false },
  { name: "a list that could not be read", cwd: "/w", answer: null, unknown: null, running: false },
  { name: "no sessions", cwd: "/w", answer: { sessions: [] }, unknown: false, running: false },
  { name: "sessions, none running", cwd: "/w", answer: { sessions: [{ runningKey: null }, {}] }, unknown: false, running: false },
  { name: "one running", cwd: "/w", answer: { sessions: [{ runningKey: null }, { runningKey: "s" }] }, unknown: true, running: true },
];

describe("memorySessions", () => {
  it.each(CASES)("$name", async ({ cwd, answer, unknown, running }) => {
    listed.answer = answer;
    expect(await sessionRunningOrUnknown(cwd)).toBe(unknown);
    expect(await sessionRunningIn(cwd)).toBe(running);
  });
});
