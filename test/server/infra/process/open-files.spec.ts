// @vitest-environment node
import { describe, it, expect } from "vitest";
import { parseLsofWritableNames } from "../../../../server/infra/process/open-files.js";

describe("parseLsofWritableNames", () => {
  // `lsof -F an` as printed for two pids (macOS): a `p` line per process, then per descriptor `f`,
  // `a` (access) and `n` (name). cwd and txt entries carry a blank access.
  const stdout = [
    "p58107",
    "fcwd",
    "a ",
    "n/private/tmp/work",
    "p58109",
    "f19",
    "au",
    "n/private/tmp/home/state_5.sqlite",
    "f23",
    "aw",
    "n/a b/rollout.jsonl",
    "f24",
    "ar",
    "n/tmp/read-only.jsonl",
    "",
  ].join("\n");

  it("keeps the names held for writing or read-write, and drops read-only and cwd/txt", () => {
    expect(parseLsofWritableNames(stdout)).toEqual(["/private/tmp/home/state_5.sqlite", "/a b/rollout.jsonl"]);
  });

  it("does not carry one descriptor's access over to the next", () => {
    expect(parseLsofWritableNames(["p1", "f3", "aw", "n/w.jsonl", "f4", "n/no-access.jsonl"].join("\n"))).toEqual(["/w.jsonl"]);
  });

  it("returns nothing for empty or name-less output", () => {
    expect(parseLsofWritableNames("")).toEqual([]);
    expect(parseLsofWritableNames("p1\nf0\naw\nn\n")).toEqual([]);
  });
});
