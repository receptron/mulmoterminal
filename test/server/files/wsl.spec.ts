// @vitest-environment node
import { describe, it, expect } from "vitest";
import { isWsl, toLinuxPath, toWindowsPath, type WslpathRunner } from "../../../server/files/wsl.js";

describe("isWsl", () => {
  it("is true for the variables WSL exports", () => {
    expect(isWsl("linux", { WSL_DISTRO_NAME: "Ubuntu" })).toBe(true);
    expect(isWsl("linux", { WSL_INTEROP: "/run/WSL/8_interop" })).toBe(true);
  });
  // The kernel is named explicitly, not left to the runner: a maintainer running the suite ON WSL
  // would otherwise see this fail for being right.
  it("is false on a plain Linux desktop", () => {
    expect(isWsl("linux", {}, "6.8.0-45-generic")).toBe(false);
  });
  // Windows itself already has the dialog and needs no translation; reading it as WSL would send
  // every path through a `wslpath` that isn't there.
  it("is false on macOS and Windows, whatever the environment says", () => {
    expect(isWsl("darwin", { WSL_DISTRO_NAME: "Ubuntu" })).toBe(false);
    expect(isWsl("win32", { WSL_INTEROP: "/run/WSL/8_interop" })).toBe(false);
  });
});

const answers =
  (status: number | null, stdout: string): WslpathRunner =>
  () =>
    Promise.resolve({ status, stdout });

describe("wslpath conversions", () => {
  it("returns the translated path", async () => {
    await expect(toLinuxPath("C:\\proj", answers(0, "/mnt/c/proj\n"))).resolves.toBe("/mnt/c/proj");
    await expect(toWindowsPath("/home/me", answers(0, "\\\\wsl.localhost\\Ubuntu\\home\\me\n"))).resolves.toBe("\\\\wsl.localhost\\Ubuntu\\home\\me");
  });
  it("passes the right flag for each direction", async () => {
    const seen: string[][] = [];
    const record: WslpathRunner = (args) => {
      seen.push(args);
      return Promise.resolve({ status: 0, stdout: "/x" });
    };
    await toLinuxPath("C:\\x", record);
    await toWindowsPath("/x", record);
    expect(seen).toEqual([
      ["-u", "C:\\x"],
      ["-w", "/x"],
    ]);
  });
  // A null answer is what makes the caller fall back or report, rather than passing a Windows path
  // on to something that would silently reject it.
  it("is null when wslpath fails or says nothing", async () => {
    await expect(toLinuxPath("C:\\proj", answers(1, ""))).resolves.toBeNull();
    await expect(toLinuxPath("C:\\proj", answers(null, ""))).resolves.toBeNull();
    await expect(toLinuxPath("C:\\proj", answers(0, "  \n"))).resolves.toBeNull();
  });
});

// The environment variables reach a process started from a login shell. A server started by
// systemd inside the distro has neither — and reading that as "a bare Linux box" is what would
// cost a WSL user the whole fix, since the fallback there is a zenity they do not have.
describe("isWsl without the environment variables", () => {
  it("recognises a WSL2 kernel", () => {
    expect(isWsl("linux", {}, "6.6.87.2-microsoft-standard-WSL2")).toBe(true);
  });
  // WSL1 is deliberately NOT told apart: it has interop and wslpath too, so it wants the same
  // treatment. Its kernel spells the name with a capital M.
  it("recognises a WSL1 kernel", () => {
    expect(isWsl("linux", {}, "4.4.0-19041-Microsoft")).toBe(true);
  });
  it("leaves an ordinary Linux kernel alone", () => {
    expect(isWsl("linux", {}, "6.8.0-45-generic")).toBe(false);
    expect(isWsl("linux", {}, "5.15.0-1040-azure")).toBe(false);
  });
  // The variables still win, so a distro whose kernel was rebuilt under another name is covered.
  it("trusts the variables whatever the kernel is called", () => {
    expect(isWsl("linux", { WSL_INTEROP: "/run/WSL/8_interop" }, "6.8.0-45-generic")).toBe(true);
  });
});

// An empty variable is not an answer. `??` accepted it and never looked at the second one, which
// also made the server disagree with bin/mulmoterminal.js about the same machine (Codex on #1463).
describe("isWsl with an empty variable", () => {
  it("falls through an empty WSL_DISTRO_NAME to WSL_INTEROP", () => {
    expect(isWsl("linux", { WSL_DISTRO_NAME: "", WSL_INTEROP: "/run/WSL/8_interop" }, "6.8.0-45-generic")).toBe(true);
  });
  it("is still false when both are empty on an ordinary kernel", () => {
    expect(isWsl("linux", { WSL_DISTRO_NAME: "", WSL_INTEROP: "" }, "6.8.0-45-generic")).toBe(false);
  });

  // A trailing space is a legal filename character on both sides of the translation, and `trim()`
  // took it — so a file named `a ` was revealed as `a`, a different path (Codex P3 on #2039).
  // The same class as #1934 and #2040: whitespace at the edge of a name is part of the name.
  it("keeps a trailing space in the name, dropping only wslpath's own line terminator", async () => {
    await expect(toWindowsPath("/home/me/a ", answers(0, "C:\\x\\a \n"))).resolves.toBe("C:\\x\\a ");
    await expect(toWindowsPath("/home/me/a ", answers(0, "C:\\x\\a \r\n"))).resolves.toBe("C:\\x\\a ");
    await expect(toLinuxPath("C:\\x\\a ", answers(0, "/mnt/c/x/a \n"))).resolves.toBe("/mnt/c/x/a ");
  });

  // Only ONE terminator: a blank line after the path is content, not punctuation, and guessing
  // which trailing newlines are ours is how the first version lost a space.
  it("drops one line terminator, not every trailing blank line", async () => {
    await expect(toWindowsPath("/x", answers(0, "C:\\x\n\n"))).resolves.toBe("C:\\x\n");
  });
});
