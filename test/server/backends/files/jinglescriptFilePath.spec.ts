// @vitest-environment node
// Which file a value handed to manageJingleScript's files names: the plugin's own area
// (`<cwd>/jinglescript/<name>`, created), a score read as presentDocument reads a document,
// or nothing.
import { describe, it, expect } from "vitest";
import path from "node:path";
import { jingleScriptFileTarget, JINGLESCRIPT_FILE_EXTENSIONS } from "../../../../server/backends/files/jinglescriptFilePath.js";

const CWD = path.resolve("/repos/project");
const files = (name: string) => ({ area: "files", name });
const score = (value: string) => ({ area: "score", value });

describe("jingleScriptFileTarget — the plugin's own files", () => {
  it("takes every name the plugin writes", () => {
    for (const name of ["opening.mp3", "opening.wav", "opening.timing.json", "song.json", "song.abc", "song-2.json", "song-1000.timing.json"]) {
      expect(jingleScriptFileTarget(`jinglescript/${name}`, CWD)).toEqual(files(name));
    }
  });

  it("takes every extension of the area, in any case, and a stem the plugin allows", () => {
    for (const ext of JINGLESCRIPT_FILE_EXTENSIONS) {
      expect(jingleScriptFileTarget(`jinglescript/a${ext}`, CWD)).toEqual(files(`a${ext}`));
      expect(jingleScriptFileTarget(`jinglescript/A${ext.toUpperCase()}`, CWD)).toEqual(files(`A${ext.toUpperCase()}`));
    }
    expect(jingleScriptFileTarget("jinglescript/_x.y-z.mp3", CWD)).toEqual(files("_x.y-z.mp3"));
  });

  it("does not depend on the cwd: the name is the same wherever the session runs", () => {
    expect(jingleScriptFileTarget("jinglescript/a.mp3", path.resolve("/elsewhere"))).toEqual(files("a.mp3"));
  });

  it("refuses an audio or ABC name anywhere but directly in the area", () => {
    for (const value of [
      "jinglescript/sub/a.mp3",
      "jinglescript/../a.mp3",
      "jinglescript/./a.wav",
      "jinglescript//a.mp3",
      "jinglescript\\a.mp3",
      "Jinglescript/a.mp3",
      "other/a.mp3",
      "a.mp3",
      "./jinglescript/a.mp3",
      "/jinglescript/a.mp3",
      path.join(CWD, "jinglescript", "a.mp3"),
      "jinglescript/a.abc/",
    ]) {
      expect(jingleScriptFileTarget(value, CWD), value).toBeNull();
    }
  });

  it("refuses a dotfile, an extension alone, a bare folder and other extensions", () => {
    for (const value of [
      "jinglescript/.mp3",
      "jinglescript/.hidden.mp3",
      "jinglescript/..mp3",
      "jinglescript/",
      "jinglescript",
      "jinglescript/a.txt",
      "jinglescript/a.mp3.sh",
      "jinglescript/a.mp4",
      "jinglescript/a",
      "jinglescript/a b.mp3",
      "jinglescript/a:b.wav",
    ]) {
      expect(jingleScriptFileTarget(value, CWD), value).toBeNull();
    }
  });

  it("refuses a name longer than any the plugin makes", () => {
    expect(jingleScriptFileTarget(`jinglescript/${"a".repeat(124)}.mp3`, CWD)).toEqual(files(`${"a".repeat(124)}.mp3`));
    expect(jingleScriptFileTarget(`jinglescript/${"a".repeat(125)}.mp3`, CWD)).toBeNull();
  });
});

describe("jingleScriptFileTarget — a score named by path", () => {
  it("resolves a relative score against the session's directory", () => {
    expect(jingleScriptFileTarget("scores/opening.json", CWD)).toEqual(score(path.join(CWD, "scores", "opening.json")));
    expect(jingleScriptFileTarget("opening.JSON", CWD)).toEqual(score(path.join(CWD, "opening.JSON")));
  });

  it("keeps an absolute score and the workspace's artifacts as they are", () => {
    const abs = path.resolve("/data/scores/a.json");
    expect(jingleScriptFileTarget(abs, CWD)).toEqual(score(abs));
    expect(jingleScriptFileTarget("artifacts/scores/a.json", CWD)).toEqual(score("artifacts/scores/a.json"));
  });

  it("reads a `.json` under the area that is not one of its files as a score, as before the area existed", () => {
    expect(jingleScriptFileTarget("jinglescript/sub/a.json", CWD)).toEqual(score(path.join(CWD, "jinglescript", "sub", "a.json")));
    expect(jingleScriptFileTarget("jinglescript/.hidden.json", CWD)).toEqual(score(path.join(CWD, "jinglescript", ".hidden.json")));
  });

  it("hands a `.json` core would refuse to core unchanged, never laundered into an absolute path", () => {
    for (const value of ["../up.json", "a/../b.json", "./a.json", "a//b.json", "jinglescript/../a.json"]) {
      expect(jingleScriptFileTarget(value, CWD), value).toEqual(score(value));
    }
  });
});

describe("jingleScriptFileTarget — not a path", () => {
  it("refuses every non-string and the empty string", () => {
    for (const value of [undefined, null, 0, 1, true, {}, [], ["jinglescript/a.mp3"], ""]) {
      expect(jingleScriptFileTarget(value, CWD)).toBeNull();
    }
  });

  it("refuses NUL anywhere, and a path that is neither area nor score", () => {
    for (const value of ["jinglescript/a\0.mp3", "a\0.json", "notes.md", "a.mp3", "a.json.md"]) {
      expect(jingleScriptFileTarget(value, CWD), JSON.stringify(value)).toBeNull();
    }
  });
});
