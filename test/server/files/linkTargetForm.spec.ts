// @vitest-environment node
import { describe, it, expect } from "vitest";
import { unwalkableLinkTarget } from "../../../server/files/linkTargetForm";

describe("unwalkableLinkTarget", () => {
  it.each(["C:foo", "c:foo\\bar", "Z:..", "\\\\server\\share\\x", "\\\\?\\C:\\x", "\\\\?\\UNC\\server\\share\\..", "\\\\.\\pipe\\x", "//server/share"])(
    "refuses %s on Windows",
    (target) => {
      expect(unwalkableLinkTarget(target, "win32")).toBe(true);
    },
  );

  it.each(["C:\\outside\\x", "C:/outside/x", "\\outside\\x", "..\\x", "hop\\..\\x", "x", ".", "", "C:"])("walks %s on Windows", (target) => {
    // A bare `C:` is drive-relative too, and refused; everything else here is walked.
    expect(unwalkableLinkTarget(target, "win32")).toBe(target === "C:");
  });

  it.each(["C:foo", "\\\\server\\share", "//server/share", "/abs/x", "../x", ""])("walks %s everywhere but Windows", (target) => {
    (["darwin", "linux"] as const).forEach((platform) => expect(unwalkableLinkTarget(target, platform)).toBe(false));
  });
});
