// @vitest-environment node
import { describe, it, expect } from "vitest";
import { browseEntryOf, type FollowedStat } from "../../../server/files/browseEntry";

const folder: FollowedStat = { isDirectory: () => true, size: 96 };
const file = (size: number): FollowedStat => ({ isDirectory: () => false, size });

describe("browseEntryOf", () => {
  it("takes a directory entry as a folder without asking where it leads", () => {
    const followed = () => {
      throw new Error("stat should not be needed");
    };
    expect(browseEntryOf("src", true, followed)).toEqual({ name: "src", dir: true, size: 0 });
  });

  it("lists an entry that leads to a folder (a link or a junction) as a folder", () => {
    expect(browseEntryOf("link", false, () => folder)).toEqual({ name: "link", dir: true, size: 0 });
  });

  it("keeps a file, or a link to one, a file with the size it leads to", () => {
    expect(browseEntryOf("a.txt", false, () => file(5))).toEqual({ name: "a.txt", dir: false, size: 5 });
    expect(browseEntryOf("empty", false, () => file(0))).toEqual({ name: "empty", dir: false, size: 0 });
  });

  it("leaves an entry whose stat cannot be had a file of size 0", () => {
    expect(browseEntryOf("broken", false, () => null)).toEqual({ name: "broken", dir: false, size: 0 });
  });
});
