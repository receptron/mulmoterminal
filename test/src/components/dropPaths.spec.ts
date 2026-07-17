import { describe, it, expect } from "vitest";
import { parseFileUris, toShellArg, toInsertText, dropTextFromUriList } from "./dropPaths";

describe("parseFileUris", () => {
  it("parses a single file:// URI into an absolute path", () => {
    expect(parseFileUris("file:///Users/me/a.txt")).toEqual(["/Users/me/a.txt"]);
  });

  it("parses multiple newline-separated URIs", () => {
    expect(parseFileUris("file:///a/b.txt\nfile:///c/d.txt")).toEqual(["/a/b.txt", "/c/d.txt"]);
  });

  it("decodes percent-encoded characters (spaces, unicode)", () => {
    expect(parseFileUris("file:///Users/me/My%20File.txt")).toEqual(["/Users/me/My File.txt"]);
    expect(parseFileUris("file:///Users/me/%E6%97%A5%E6%9C%AC.md")).toEqual(["/Users/me/日本.md"]);
  });

  it("ignores comment lines and blanks (uri-list format)", () => {
    expect(parseFileUris("# comment\n\nfile:///a.txt\n")).toEqual(["/a.txt"]);
  });

  it("skips non-file:// lines (http, bare text)", () => {
    expect(parseFileUris("https://example.com\njust text\nfile:///a.txt")).toEqual(["/a.txt"]);
  });

  it("strips the leading slash from a Windows drive path", () => {
    expect(parseFileUris("file:///C:/Users/me/a.txt")).toEqual(["C:/Users/me/a.txt"]);
  });

  it("preserves the host for a UNC share (does not drop the authority)", () => {
    expect(parseFileUris("file://server/share/a.txt")).toEqual(["\\\\server\\share\\a.txt"]);
  });

  it("treats a localhost authority as a local path", () => {
    expect(parseFileUris("file://localhost/Users/me/a.txt")).toEqual(["/Users/me/a.txt"]);
  });

  it("returns empty for empty or path-less input", () => {
    expect(parseFileUris("")).toEqual([]);
    expect(parseFileUris("# only a comment")).toEqual([]);
  });
});

describe("toShellArg", () => {
  it("leaves a bare safe path unquoted", () => {
    expect(toShellArg("/Users/me/a.txt")).toBe("/Users/me/a.txt");
  });

  it("single-quotes paths with spaces or shell-special chars", () => {
    expect(toShellArg("/Users/me/My File.txt")).toBe("'/Users/me/My File.txt'");
    expect(toShellArg("/Users/me/a;rm -rf b")).toBe("'/Users/me/a;rm -rf b'");
  });

  it("escapes embedded single quotes", () => {
    expect(toShellArg("/Users/me/it's.txt")).toBe("'/Users/me/it'\\''s.txt'");
  });
});

describe("toInsertText", () => {
  it("joins quoted paths with spaces", () => {
    expect(toInsertText(["/a.txt", "/My Dir/b.txt"])).toBe("/a.txt '/My Dir/b.txt'");
  });
  it("returns empty string for no paths", () => {
    expect(toInsertText([])).toBe("");
  });
});

describe("dropTextFromUriList", () => {
  it("joins quoted paths with spaces", () => {
    expect(dropTextFromUriList("file:///a.txt\nfile:///My%20Dir/b.txt")).toBe("/a.txt '/My Dir/b.txt'");
  });

  it("returns empty string when no file path is present", () => {
    expect(dropTextFromUriList("")).toBe("");
    expect(dropTextFromUriList("https://example.com")).toBe("");
  });
});
