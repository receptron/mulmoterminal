// How the Library lists a conversation (#3329): its group by day, its grey meta line, and the
// labels in the reader's language — every boundary asserted with a fixed `now`.
import { describe, it, expect, vi } from "vitest";
import { costLabel, groupConversations, groupOf, metaParts, prsLabel, projectName, whenLabel } from "../../../../src/components/library/libraryRows";
import type { LibraryConversation } from "../../../../common/library";

const NOW = new Date(2026, 10, 19, 15, 0, 0).getTime(); // a Thursday afternoon, local time
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const conversation = (over: Partial<LibraryConversation> = {}): LibraryConversation => ({
  ...{
    id: "s",
    agent: "claude",
    title: "T",
    cwd: "/Users/me/work/clip-studio",
    gitBranch: "main",
    prs: [],
    costUsd: null,
    linesAdded: null,
    linesRemoved: null,
  },
  ...{ startedAt: null, endedAt: NOW, skills: [], hookErrors: 0, userTurns: 1, isSidechain: false, parentId: null, isTemporary: false, entrypoint: "cli" },
  ...over,
});

describe("groupOf", () => {
  const midnight = new Date(2026, 10, 19, 0, 0, 0).getTime();
  it.each([
    ["now", NOW, "today"],
    ["the first moment of today", midnight, "today"],
    ["the last moment of yesterday", midnight - 1, "week"],
    ["six days before today began", midnight - 6 * DAY, "week"],
    ["just before that", midnight - 6 * DAY - 1, "older"],
    ["no time at all", null, "older"],
  ] as const)("%s → %s", (_label, endedAt, expected) => {
    expect(groupOf(endedAt, NOW)).toBe(expected);
  });
});

describe("groupConversations", () => {
  it("keeps the given order inside each group and leaves empty groups out", () => {
    const rows = [conversation({ id: "a", endedAt: NOW }), conversation({ id: "b", endedAt: NOW - 30 * DAY }), conversation({ id: "c", endedAt: NOW - HOUR })];
    expect(groupConversations(rows, NOW).map((g) => [g.group, g.conversations.map((c) => c.id)])).toEqual([
      ["today", ["a", "c"]],
      ["older", ["b"]],
    ]);
    expect(groupConversations([], NOW)).toEqual([]);
  });
});

describe("projectName", () => {
  it.each([
    ["/Users/me/work/clip-studio", "clip-studio"],
    ["/Users/me/work/clip-studio/", "clip-studio"],
    ["C:\\Users\\me\\proj", "proj"],
    ["/", null],
    ["", null],
    [null, null],
  ] as const)("%s → %s", (cwd, expected) => {
    expect(projectName(cwd)).toBe(expected);
  });
});

describe("whenLabel", () => {
  it.each([
    [NOW - 30 * 1000, "en", "now"],
    [NOW - 5 * MINUTE, "en", "5 minutes ago"],
    [NOW - 2 * HOUR, "en", "2 hours ago"],
    [NOW - 3 * DAY, "en", "3 days ago"],
    [NOW - 2 * HOUR, "ja", "2 時間前"],
    [NOW - 1 * DAY, "ja", "昨日"],
  ] as const)("%s in %s", (endedAt, locale, expected) => {
    expect(whenLabel(endedAt, NOW, locale)).toBe(expected);
  });

  it("shows a date past a week, with the year only when it is not this one", () => {
    expect(whenLabel(new Date(2026, 9, 28).getTime(), NOW, "en")).toBe("Oct 28");
    expect(whenLabel(new Date(2025, 9, 28).getTime(), NOW, "en")).toBe("Oct 28, 2025");
  });

  it("says nothing for no time, and treats a time in the future as now", () => {
    expect(whenLabel(null, NOW, "en")).toBe("");
    expect(whenLabel(NOW + HOUR, NOW, "en")).toBe("now");
  });
});

describe("metaParts", () => {
  it("names the project, branch, PRs and when, leaving out what is absent", () => {
    const full = conversation({
      endedAt: NOW - 2 * HOUR,
      prs: [
        { number: 212, url: "u", repository: "o/r" },
        { number: 213, url: "v", repository: "o/r" },
      ],
    });
    expect(metaParts(full, NOW, "en")).toEqual(["clip-studio", "main", "#213 #212", "2 hours ago"]);
    expect(metaParts(conversation({ cwd: null, gitBranch: null, endedAt: null }), NOW, "en")).toEqual([]);
  });
});

describe("costLabel", () => {
  it("formats dollars in the reader's locale, and says nothing for no cost", () => {
    expect(costLabel(0.8412, "en")).toBe("$0.84");
    expect(costLabel(0, "en")).toBe("$0.00");
    expect(costLabel(null, "en")).toBeNull();
  });
});

describe("prsLabel", () => {
  const prs = (count: number) => Array.from({ length: count }, (_, i) => ({ number: 100 + i, url: "u", repository: "o/r" }));
  it.each([
    [0, ""],
    [1, "#100"],
    [3, "#102 #101 #100"],
    [45, "#144 #143 #142 +42"],
  ])("%i PRs → %s", (count, expected) => {
    expect(prsLabel(prs(count))).toBe(expected);
  });
});

describe("groupOf across a daylight-saving change", () => {
  // Clocks go back an hour in New York on 1 Nov 2026. Six days before 4 Nov began is local midnight
  // on 29 Oct; six 24-hour steps back would land at 01:00 instead and call 00:30 "older".
  it("draws the week boundary at local midnight", () => {
    vi.stubEnv("TZ", "America/New_York");
    try {
      const now = new Date(2026, 10, 4, 12, 0).getTime();
      expect(groupOf(new Date(2026, 9, 29, 0, 30).getTime(), now)).toBe("week");
      expect(groupOf(new Date(2026, 9, 28, 23, 30).getTime(), now)).toBe("older");
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
