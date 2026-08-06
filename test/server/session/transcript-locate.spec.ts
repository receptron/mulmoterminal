import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, writeFileSync, rmSync, renameSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { makeTempDir } from "../../support/tempDir.js";
import { encodeProjectDirName, projectSessionsDir } from "../../../server/session/project-dir.js";
import { forgetTranscriptLocation, transcriptDir, transcriptFile } from "../../../server/session/transcript-locate.js";

// A real ~/.claude/projects tree, because the whole point of this module is that the filesystem
// is the only thing that still knows where a transcript went.
let home = "";
const ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MAIN = "/work/repo";
const WORKTREE = "/work/wt/fix-login";

const dirFor = (cwd: string) => path.join(home, ".claude", "projects", encodeProjectDirName(path.resolve(cwd)));
const write = (cwd: string, id = ID) => {
  const dir = dirFor(cwd);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `${id}.jsonl`), "{}\n");
  return path.join(dir, `${id}.jsonl`);
};

beforeEach(() => {
  home = makeTempDir("mt-locate-");
  vi.spyOn(os, "homedir").mockReturnValue(home);
  forgetTranscriptLocation(ID);
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(home, { recursive: true, force: true });
});

describe("transcriptFile", () => {
  it("uses the given cwd when the transcript is where that says", () => {
    const written = write(MAIN);
    expect(transcriptFile(ID, MAIN)).toBe(written);
  });

  it("finds a transcript the CLI moved to another directory's project dir", () => {
    // The session was started in the repo and sent into a worktree; the file went with it.
    const moved = write(WORKTREE);
    expect(transcriptFile(ID, MAIN)).toBe(moved);
  });

  it("answers as before when no transcript exists anywhere", () => {
    // Callers decide for themselves what a missing file means, so the stale-cwd answer is the
    // right one to hand back — it keeps "no transcript" reading as "no transcript".
    expect(transcriptFile(ID, MAIN)).toBe(path.join(projectSessionsDir(MAIN), `${ID}.jsonl`));
  });

  it("follows a second move rather than trusting what it found last time", () => {
    write(MAIN);
    expect(transcriptDir(ID, MAIN)).toBe(dirFor(MAIN));
    mkdirSync(dirFor(WORKTREE), { recursive: true });
    renameSync(path.join(dirFor(MAIN), `${ID}.jsonl`), path.join(dirFor(WORKTREE), `${ID}.jsonl`));
    expect(transcriptDir(ID, MAIN)).toBe(dirFor(WORKTREE));
  });

  it("takes the hint back the moment the session returns to it", () => {
    write(WORKTREE);
    expect(transcriptDir(ID, MAIN)).toBe(dirFor(WORKTREE));
    rmSync(path.join(dirFor(WORKTREE), `${ID}.jsonl`));
    write(MAIN);
    expect(transcriptDir(ID, MAIN)).toBe(dirFor(MAIN));
  });

  it("does not confuse one session's move with another's", () => {
    const other = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    write(WORKTREE);
    write(MAIN, other);
    expect(transcriptDir(ID, MAIN)).toBe(dirFor(WORKTREE));
    expect(transcriptDir(other, MAIN)).toBe(dirFor(MAIN));
  });

  it("survives a missing projects root", () => {
    rmSync(path.join(home, ".claude"), { recursive: true, force: true });
    expect(transcriptFile(ID, MAIN)).toBe(path.join(projectSessionsDir(MAIN), `${ID}.jsonl`));
  });
});
