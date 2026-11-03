import { describe, it, expect } from "vitest";
import { isTerminalWindowsPty, windowsPtyFor } from "../../common/terminalWindowsPty";

describe("windowsPtyFor", () => {
  it("names ConPTY and the build on Windows 10 and 11, which share a release prefix", () => {
    expect(windowsPtyFor("win32", "10.0.19045")).toEqual({ backend: "conpty", buildNumber: 19045 });
    expect(windowsPtyFor("win32", "10.0.22631")).toEqual({ backend: "conpty", buildNumber: 22631 });
  });

  it("is null off Windows, whatever the release says", () => {
    ["darwin", "linux", "freebsd"].forEach((platform) => expect(windowsPtyFor(platform, "10.0.22631"), platform).toBeNull());
  });

  it("is null for a release it cannot read a build from", () => {
    ["", "10.0", "10.0.", "10.0.abc", "10.0.0", "10.0.22631.1", "a.b.22631", " 10.0.22631", "10.0.-5", "10.0.99999999999999999999"].forEach((release) =>
      expect(windowsPtyFor("win32", release), release).toBeNull(),
    );
  });
});

describe("isTerminalWindowsPty", () => {
  it("accepts what windowsPtyFor produces", () => {
    expect(isTerminalWindowsPty({ backend: "conpty", buildNumber: 22631 })).toBe(true);
  });

  it("rejects anything else", () => {
    [
      null,
      undefined,
      "conpty",
      22631,
      [],
      {},
      { backend: "winpty", buildNumber: 19045 },
      { backend: "conpty" },
      { backend: "conpty", buildNumber: "22631" },
      { backend: "conpty", buildNumber: 0 },
      { backend: "conpty", buildNumber: 1.5 },
      { backend: "conpty", buildNumber: Number.NaN },
    ].forEach((value) => expect(isTerminalWindowsPty(value), JSON.stringify(value)).toBe(false));
  });
});
