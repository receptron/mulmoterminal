// @vitest-environment node
// The board's per-repository review settings (#3409): one board load finds the clones once, however
// many repositories it shows, and reads each repository's settings from its default clone.
import { describe, it, expect, vi, beforeEach } from "vitest";

const repoDirsFromPresets = vi.fn();
const loadDirConfig = vi.fn();
vi.mock("../../../server/git/repo-dirs.js", () => ({ repoDirsFromPresets }));
vi.mock("../../../server/config/config-routes.js", () => ({ getCwdPresets: () => [], getRepoDirs: () => ({}) }));
vi.mock("../../../server/config/dir/dir-config.js", () => ({ loadDirConfig }));

const { requiredLgtmLookup } = await import("../../../server/git/repo-review.js");

const candidate = (path: string) => ({ path, label: path, orderPriority: null });

beforeEach(() => {
  repoDirsFromPresets.mockReset();
  repoDirsFromPresets.mockResolvedValue([
    { repo: "o/declared", dirs: [candidate("/a")], primary: null },
    { repo: "o/plain", dirs: [candidate("/b")], primary: null },
  ]);
  loadDirConfig.mockReset();
  loadDirConfig.mockImplementation((dir: string) => ({ review: dir === "/a" ? { reviewer: "codex", maxRounds: 10, requiredLgtm: 2 } : null }));
});

describe("requiredLgtmLookup", () => {
  it("finds the clones once per load and answers each repository from its own clone", async () => {
    const lookup = requiredLgtmLookup();
    expect(await Promise.all([lookup("o/declared"), lookup("O/Declared"), lookup("o/plain"), lookup("o/unknown")])).toEqual([2, 2, null, null]);
    expect(repoDirsFromPresets).toHaveBeenCalledTimes(1);
    expect(loadDirConfig).not.toHaveBeenCalledWith("/unknown");
  });

  it("finds them again on the next load, so a changed setting shows on the next refresh", async () => {
    await requiredLgtmLookup()("o/declared");
    await requiredLgtmLookup()("o/declared");
    expect(repoDirsFromPresets).toHaveBeenCalledTimes(2);
  });
});
