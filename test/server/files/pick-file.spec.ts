import { describe, it, expect } from "vitest";
import { pickFileCommand, parsePickerOutput } from "../../../server/files/../../server/files/pick-file.js";

describe("pickFileCommand", () => {
  it("uses osascript on macOS", () => {
    expect(pickFileCommand("darwin").cmd).toBe("osascript");
  });
  it("uses powershell on Windows", () => {
    expect(pickFileCommand("win32").cmd).toBe("powershell");
  });
  it("falls back to zenity elsewhere (Linux)", () => {
    expect(pickFileCommand("linux").cmd).toBe("zenity");
  });
});

describe("pickFileCommand (directory mode)", () => {
  it("macOS: osascript 'choose folder'", () => {
    const { cmd, args } = pickFileCommand("darwin", true);
    expect(cmd).toBe("osascript");
    expect(args.join(" ")).toContain("choose folder");
  });
  it("Windows: FolderBrowserDialog", () => {
    expect(pickFileCommand("win32", true).args.join(" ")).toContain("FolderBrowserDialog");
  });
  it("Linux: zenity --directory", () => {
    expect(pickFileCommand("linux", true).args).toContain("--directory");
  });
  it("file mode (default) is unchanged", () => {
    expect(pickFileCommand("darwin").args.join(" ")).toContain("choose file");
    expect(pickFileCommand("win32").args.join(" ")).toContain("OpenFileDialog");
    expect(pickFileCommand("linux").args).toContain("--multiple");
  });
});

describe("parsePickerOutput", () => {
  it("splits newline-separated absolute paths", () => {
    expect(parsePickerOutput("/a/b.txt\n/c/d.txt")).toEqual(["/a/b.txt", "/c/d.txt"]);
  });
  it("trims and drops blank lines", () => {
    expect(parsePickerOutput("  /a.txt  \n\n")).toEqual(["/a.txt"]);
  });
  it("handles CRLF output", () => {
    expect(parsePickerOutput("/a.txt\r\n/b.txt\r\n")).toEqual(["/a.txt", "/b.txt"]);
  });
  it("rejects relative or junk lines (e.g. a cancel message)", () => {
    expect(parsePickerOutput("not a path\nrelative/p.txt")).toEqual([]);
  });
  it("returns empty for empty output (user canceled)", () => {
    expect(parsePickerOutput("")).toEqual([]);
  });
});
