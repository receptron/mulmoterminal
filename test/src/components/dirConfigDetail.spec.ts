import { describe, it, expect } from "vitest";
import { dirConfigRows, parseDirConfigDetail, sortDirPathsByName } from "../../../src/components/dirConfigDetail";

describe("dirConfigRows", () => {
  it("has no rows for a directory that configured nothing", () => {
    expect(dirConfigRows({})).toEqual([]);
    expect(dirConfigRows(null)).toEqual([]);
  });

  // #1062. A boolean setting has no resolved value to read back off the per-cell config the way a
  // colour does, so it reaches the preview through `extras`. Without a row, a file whose only
  // setting is this one renders as "sets nothing this app applies" — the opposite of the truth,
  // on the panel someone opens BECAUSE a setting looks like it isn't working.
  describe("appendSystemPrompt", () => {
    it.each([
      ["off", false, "off"],
      ["on", true, "on"],
    ])("shows an explicit %s", (_case, appendSystemPrompt, value) => {
      const rows = dirConfigRows({}, { appendSystemPrompt });
      expect(rows).toEqual([{ key: "appendSystemPrompt", label: "Closing summary", value, color: null }]);
    });

    it.each([
      ["the key is absent", {}],
      ["the loader rejected the value", { appendSystemPrompt: null }],
      ["it arrived as something other than a boolean", { appendSystemPrompt: "off" }],
    ])("shows no row when %s", (_case, extras) => {
      expect(dirConfigRows({}, extras)).toEqual([]);
    });
  });

  it("lists only what is set, name first and colours in the order the eye meets them", () => {
    const rows = dirConfigRows({ name: "proj", badgeColor: "#445566", headerColor: "#112233", fontSize: 14 });
    expect(rows.map((r) => r.key)).toEqual(["name", "headerColor", "badgeColor", "fontSize"]);
    expect(rows.map((r) => r.value)).toEqual(["proj", "#112233", "#445566", "14px"]);
  });

  // The swatch is drawn off `color`; a non-colour row must not get one, or the preview would
  // paint a box from a font name.
  it("marks colour rows as colours and leaves the rest without one", () => {
    const rows = dirConfigRows({ headerColor: "#112233", fontFamily: "'Cica', monospace" });
    expect(rows.find((r) => r.key === "headerColor")?.color).toBe("#112233");
    expect(rows.find((r) => r.key === "fontFamily")?.color).toBeNull();
  });

  it("summarises the palette by count rather than listing xterm's keys", () => {
    expect(dirConfigRows({ colors: { background: "#000", foreground: "#fff" } })[0]).toEqual({
      key: "colors",
      label: "Palette overrides",
      value: "2 colours",
      color: null,
    });
    expect(dirConfigRows({ colors: { background: "#000" } })[0]?.value).toBe("1 colour");
  });

  // Priority 0 is a real rank (it sorts first) — dropping it as falsy would hide the setting
  // from the one screen meant to explain where a cell's position comes from.
  it("keeps a zero grid priority", () => {
    expect(dirConfigRows({ orderPriority: 0 })[0]?.value).toBe("0");
  });

  it("reports a configured sound without exposing its path", () => {
    expect(dirConfigRows({ hasSound: true })[0]?.label).toBe("Attention sound");
    expect(dirConfigRows({ hasSound: false })).toEqual([]);
  });

  // Settings the per-cell config deliberately doesn't carry: without these the preview could
  // name `provider` as applied but never show what it was set to (CodeRabbit, #952).
  it("shows the settings a running terminal has no use for", () => {
    const rows = dirConfigRows({}, { provider: "openrouter", model: "kimi-k2", skills: ["deploy", "review"], addDirs: ["/shared/lib"] });
    expect(rows.map((r) => [r.label, r.value])).toEqual([
      ["Provider", "openrouter"],
      ["Model", "kimi-k2"],
      ["Skill menu", "deploy, review"],
      ["Extra directories", "/shared/lib"],
    ]);
  });

  // Labels only: a button's `cmd` is what it would type into the session, which is neither what
  // "did my config take effect" needs nor something a settings screenshot should carry.
  it("names header buttons and chips without their commands", () => {
    const rows = dirConfigRows({}, { buttonLabels: ["Deploy"], chipLabels: ["git", "Build"] });
    expect(rows.map((r) => [r.label, r.value])).toEqual([
      ["Header buttons", "Deploy"],
      ["Header chips", "git, Build"],
    ]);
  });

  it("has no extra rows when the directory sets none of them", () => {
    expect(dirConfigRows({ name: "proj" }, { provider: null, model: null, skills: null, addDirs: null, buttonLabels: [], chipLabels: [] })).toHaveLength(1);
  });
});

describe("parseDirConfigDetail", () => {
  it("reads a full response", () => {
    const view = parseDirConfigDetail({
      exists: true,
      file: "/proj/.mulmoterminal.json",
      config: { name: "proj" },
      source: { applied: ["name"], ignored: ["cellColor"], unknown: ["badgeColour"] },
    });
    expect(view.exists).toBe(true);
    expect(view.file).toBe("/proj/.mulmoterminal.json");
    expect(view.rows.map((r) => r.key)).toEqual(["name"]);
    expect(view.source).toEqual({ applied: ["name"], ignored: ["cellColor"], unknown: ["badgeColour"] });
  });

  // The wire is a trust boundary like every other parser here: a shape the server would never
  // send must leave the preview empty rather than reaching the template.
  it("falls back to an empty view for anything unexpected on the wire", () => {
    expect(parseDirConfigDetail(null)).toEqual({ exists: false, file: null, rows: [], source: { applied: [], ignored: [], unknown: [] } });
    expect(parseDirConfigDetail({ file: 7, config: "nope", source: { applied: "name" } })).toEqual({
      exists: false,
      file: null,
      rows: [],
      source: { applied: [], ignored: [], unknown: [] },
    });
  });

  it("keeps only the string entries of a key list", () => {
    expect(parseDirConfigDetail({ source: { ignored: ["cellColor", 3, null] } }).source.ignored).toEqual(["cellColor"]);
  });
});

// The chips list recent-first; this one is a reference you scan for a directory you already
// have in mind, so it goes by name.
describe("sortDirPathsByName", () => {
  it("orders by the name shown, not by the order the directories were used", () => {
    expect(sortDirPathsByName(["/x/zeta", "/y/alpha", "/z/mid"])).toEqual(["/y/alpha", "/z/mid", "/x/zeta"]);
  });

  it("counts numbers as numbers, so proj2 comes before proj10", () => {
    expect(sortDirPathsByName(["/w/proj10", "/w/proj2"])).toEqual(["/w/proj2", "/w/proj10"]);
  });

  it("ignores case rather than sorting every capital ahead of every lowercase", () => {
    expect(sortDirPathsByName(["/w/beta", "/w/Alpha"])).toEqual(["/w/Alpha", "/w/beta"]);
  });

  // Two checkouts of one repo share a basename; without the path tie-break their order would
  // depend on the incoming order, and the list would shuffle as the recents do.
  it("breaks a tie on the full path", () => {
    expect(sortDirPathsByName(["/b/proj", "/a/proj"])).toEqual(["/a/proj", "/b/proj"]);
  });

  it("labels a managed worktree the way the row does", () => {
    expect(sortDirPathsByName(["/w/zeta", "/w/worktrees/alpha-1a2b3c4d/task"])).toEqual(["/w/worktrees/alpha-1a2b3c4d/task", "/w/zeta"]);
  });

  it("leaves the caller's array untouched", () => {
    const paths = ["/x/b", "/x/a"];
    sortDirPathsByName(paths);
    expect(paths).toEqual(["/x/b", "/x/a"]);
  });
});
