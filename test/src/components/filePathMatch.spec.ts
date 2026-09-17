import { describe, it, expect } from "vitest";
import { compareMatches, finderRow, highlightParts, matchPath, normalizeQuery, rankPaths } from "../../../src/components/filePathMatch";

/** The path a query is ranked highest against, out of a candidate set. */
const best = (paths: string[], query: string): string | undefined => rankPaths(paths, query, paths.length)[0]?.path;

/** What the highlight would actually underline — the whole point of `indexes` is that it names
 *  the characters that matched, so a test that only checks the score proves nothing about it. */
const matchedChars = (path: string, query: string): string => (matchPath(path, query)?.indexes ?? []).map((i) => path[i]?.toLowerCase()).join("");

describe("normalizeQuery", () => {
  it("lower-cases and drops whitespace, so a pasted fragment still matches", () => {
    expect(normalizeQuery("  Files Pane \n")).toBe("filespane");
  });

  it("is empty for a query that was only whitespace", () => {
    expect(normalizeQuery("   ")).toBe("");
  });
});

describe("matchPath — what matches at all", () => {
  it("matches a subsequence, not only a substring", () => {
    expect(matchPath("src/components/FilesPane.vue", "srcfp")).not.toBeNull();
  });

  it("refuses a query whose characters are out of order", () => {
    expect(matchPath("src/components/FilesPane.vue", "enapslif")).toBeNull();
  });

  it("refuses a query longer than the path", () => {
    expect(matchPath("a.ts", "aaaaaaaa")).toBeNull();
  });

  it("refuses a character the path does not hold", () => {
    expect(matchPath("src/a.ts", "srcz")).toBeNull();
  });

  it("ignores case in both directions", () => {
    expect(matchPath("src/FilesPane.vue", "FILESPANE")).not.toBeNull();
    expect(matchPath("src/FILESPANE.vue", "filespane")).not.toBeNull();
  });

  it("matches every path with an empty query, scoring them all the same", () => {
    expect(matchPath("anything.ts", "")).toEqual({ path: "anything.ts", score: 0, indexes: [] });
  });

  it("has nothing to match in an empty path", () => {
    expect(matchPath("", "a")).toBeNull();
  });
});

describe("matchPath — where it says the match landed", () => {
  it("reports indexes that spell the query back", () => {
    expect(matchedChars("src/components/FilesPane.vue", "fpane")).toBe("fpane");
  });

  it("reports them in ascending order", () => {
    const indexes = matchPath("src/components/FilesPane.vue", "scfp")?.indexes ?? [];
    expect(indexes).toEqual([...indexes].sort((a, b) => a - b));
  });

  // The failure this rules out is the whole reason the scoring is a matrix and not a greedy scan:
  // greedily, the `t` of "test" is spent inside "componenTs" and the run at the file name is lost.
  it("prefers the run in the file name over an earlier scattered alignment", () => {
    expect(matchPath("src/components/testLatest.ts", "test")?.indexes).toEqual([15, 16, 17, 18]);
  });
});

describe("rankPaths — the order a reader sees", () => {
  it("puts a hit on the file name above one strewn through the directories", () => {
    expect(best(["source/routes/controllers/entry.ts", "src/core.ts"], "src")).toBe("src/core.ts");
  });

  it("prefers an unbroken run to the same characters spread out", () => {
    expect(best(["s-e-t-t-i-n-g-s.ts", "settings.ts"], "settings")).toBe("settings.ts");
  });

  it("prefers a match at the start of a word to one inside it", () => {
    expect(best(["src/unpane.ts", "src/pane.ts"], "pane")).toBe("src/pane.ts");
  });

  it("finds a camelCase boundary without a separator to lean on", () => {
    expect(best(["src/fixedplanner.ts", "src/filesPane.ts"], "fp")).toBe("src/filesPane.ts");
  });

  it("breaks a tie on the shorter path, then on code-unit order", () => {
    expect(rankPaths(["bb/x.ts", "b/x.ts", "a/x.ts"], "x", 3).map((m) => m.path)).toEqual(["a/x.ts", "b/x.ts", "bb/x.ts"]);
  });

  it("keeps the given order for an empty query rather than showing nothing", () => {
    expect(rankPaths(["z.ts", "a.ts"], "", 5).map((m) => m.path)).toEqual(["z.ts", "a.ts"]);
  });

  it("keeps the given order for a whitespace-only query too", () => {
    expect(rankPaths(["z.ts", "a.ts"], "  ", 5).map((m) => m.path)).toEqual(["z.ts", "a.ts"]);
  });

  it("drops everything that does not match", () => {
    expect(rankPaths(["a.ts", "b.ts"], "zz", 5)).toEqual([]);
  });

  it("never returns more than the limit", () => {
    const many = Array.from({ length: 50 }, (_, i) => `src/file${i}.ts`);
    expect(rankPaths(many, "file", 10)).toHaveLength(10);
  });

  it("has nothing to rank in an empty candidate list", () => {
    expect(rankPaths([], "anything", 10)).toEqual([]);
  });
});

// Generated rather than listed: the property is about EVERY path the matcher accepts, and the
// shapes that break an alignment (a repeated character, a separator run, a query that matches in
// several places) are exactly the ones nobody writes out by hand.
describe("matchPath — the alignment is real, over generated input", () => {
  const ALPHABET = "abcab/._X";
  // A cheap deterministic generator: a seeded LCG, so a failure names one seed and re-runs.
  const rng = (seed: number) => {
    let state = seed;
    return () => {
      state = (state * 1103515245 + 12345) % 2147483648;
      return state / 2147483648;
    };
  };

  it("reports indexes that are ascending, in range, and spell the query", () => {
    const next = rng(20990917);
    let checked = 0;
    for (let n = 0; n < 2000; n += 1) {
      const path = Array.from({ length: 1 + Math.floor(next() * 24) }, () => ALPHABET[Math.floor(next() * ALPHABET.length)]).join("");
      const query = Array.from({ length: 1 + Math.floor(next() * 4) }, () => ALPHABET[Math.floor(next() * ALPHABET.length)]).join("");
      const match = matchPath(path, query);
      if (match === null) continue;
      checked += 1;
      expect(match.indexes).toHaveLength(query.length);
      expect(match.indexes.every((i, k) => i >= 0 && i < path.length && (k === 0 || i > (match.indexes[k - 1] ?? -1)))).toBe(true);
      expect(match.indexes.map((i) => path[i]?.toLowerCase()).join("")).toBe(query.toLowerCase());
    }
    // A run where nothing matched would pass every assertion above and prove nothing.
    expect(checked).toBeGreaterThan(100);
  });

  it("accepts exactly what a plain subsequence test accepts", () => {
    const next = rng(776643);
    const isSub = (haystack: string, needle: string): boolean => {
      let at = 0;
      for (const char of needle.toLowerCase()) {
        at = haystack.toLowerCase().indexOf(char, at) + 1;
        if (at === 0) return false;
      }
      return true;
    };
    for (let n = 0; n < 2000; n += 1) {
      const path = Array.from({ length: 1 + Math.floor(next() * 20) }, () => ALPHABET[Math.floor(next() * ALPHABET.length)]).join("");
      const query = Array.from({ length: 1 + Math.floor(next() * 5) }, () => ALPHABET[Math.floor(next() * ALPHABET.length)]).join("");
      expect(matchPath(path, query) !== null).toBe(isSub(path, query));
    }
  });
});

describe("compareMatches", () => {
  it("is a total order: sorting twice changes nothing", () => {
    const paths = ["a/b.ts", "b.ts", "zzz/b.ts", "b/b.ts"];
    const once = rankPaths(paths, "b", 10);
    expect([...once].sort(compareMatches).map((m) => m.path)).toEqual(once.map((m) => m.path));
  });
});

describe("highlightParts", () => {
  it("merges a run of matched characters into one part", () => {
    expect(highlightParts("abcd", [1, 2])).toEqual([
      { text: "a", hit: false },
      { text: "bc", hit: true },
      { text: "d", hit: false },
    ]);
  });

  it("returns one unmatched part when nothing matched", () => {
    expect(highlightParts("abc", [])).toEqual([{ text: "abc", hit: false }]);
  });

  it("handles a match at both ends", () => {
    expect(highlightParts("abc", [0, 2])).toEqual([
      { text: "a", hit: true },
      { text: "b", hit: false },
      { text: "c", hit: true },
    ]);
  });

  it("has nothing to cut in an empty string", () => {
    expect(highlightParts("", [])).toEqual([]);
  });

  // `matchPath` indexes by UTF-16 code unit. Iterating code points here instead would shift every
  // index after an astral character by one, and the wrong character would light up — an emoji in a
  // file name is enough to do it (CodeRabbit on #2102).
  it("highlights the character the matcher matched, past an astral character", () => {
    const match = matchPath("😀a.ts", "a");
    expect(match?.indexes).toEqual([2]);
    const parts = highlightParts("😀a.ts", match?.indexes ?? []);
    expect(parts.filter((part) => part.hit).map((part) => part.text)).toEqual(["a"]);
  });

  // And the surrogate pair still renders as one character, because both of its units share a run.
  it("keeps an astral character whole", () => {
    const parts = highlightParts("😀a.ts", [2]);
    expect(parts.map((part) => part.text).join("")).toBe("😀a.ts");
    expect(parts[0]).toEqual({ text: "😀", hit: false });
  });
});

describe("finderRow", () => {
  it("splits the file's own name from the directories above it", () => {
    const row = finderRow("src/components/FilesPane.vue", []);
    expect(row.name.map((p) => p.text).join("")).toBe("FilesPane.vue");
    expect(row.dir.map((p) => p.text).join("")).toBe("src/components");
  });

  it("re-bases the name's highlights onto the name", () => {
    const match = matchPath("src/a.ts", "a");
    const row = finderRow("src/a.ts", match?.indexes ?? []);
    expect(row.name).toEqual([
      { text: "a", hit: true },
      { text: ".ts", hit: false },
    ]);
  });

  it("highlights inside the directory part too", () => {
    const row = finderRow("src/a.ts", [0]);
    expect(row.dir).toEqual([
      { text: "s", hit: true },
      { text: "rc", hit: false },
    ]);
  });

  it("has no directory part for a file at the root", () => {
    expect(finderRow("README.md", []).dir).toEqual([]);
  });

  // The separator belongs to neither side, so a query character that landed on it is simply not
  // drawn — and must not spill a highlight onto the last character of the directory.
  it("drops a match that landed on the separator itself", () => {
    expect(finderRow("src/a.ts", [3]).dir).toEqual([{ text: "src", hit: false }]);
  });
});
