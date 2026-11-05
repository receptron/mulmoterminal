// @vitest-environment node
import { describe, it, expect } from "vitest";
import { parseLsofNames } from "../../../../server/infra/process/open-files.js";

describe("parseLsofNames", () => {
  // `lsof -F n` as printed for two pids: a `p` line per process, an `f` line per descriptor.
  it("keeps only the name fields", () => {
    const stdout = ["p58107", "fcwd", "n/private/tmp/work", "p58109", "f19", "n/private/tmp/home/state_5.sqlite", "f23", "n/a b/rollout.jsonl", ""].join("\n");
    expect(parseLsofNames(stdout)).toEqual(["/private/tmp/work", "/private/tmp/home/state_5.sqlite", "/a b/rollout.jsonl"]);
  });

  it("returns nothing for empty or name-less output", () => {
    expect(parseLsofNames("")).toEqual([]);
    expect(parseLsofNames("p1\nf0\nn\n")).toEqual([]);
  });
});
