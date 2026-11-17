// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { swappableProject as project } from "../../support/swappableProject.js";
import { resolveContained } from "../../../server/files/pathContainment";
import { createFileVerified, writeVerified } from "../../../server/files/verifiedWrite";

describe("writeVerified", () => {
  it("writes, and replaces what was there, when nothing moved", () => {
    const { root, recheck, cleanup } = project();
    const abs = path.join(root, "docs", "a.md");
    expect(writeVerified(abs, Buffer.from("new"), recheck("docs/a.md"))).toBe("written");
    expect(readFileSync(abs, "utf8")).toBe("new");
    expect(writeVerified(path.join(root, "docs", "b.md"), Buffer.from("created"), recheck("docs/b.md"))).toBe("written");
    expect(readFileSync(path.join(root, "docs", "b.md"), "utf8")).toBe("created");
    cleanup();
  });

  it("leaves a file outside as it was when a folder became a link out after the check", () => {
    const { root, outside, recheck, swapOut, cleanup } = project();
    writeFileSync(path.join(outside, "a.md"), "outside, untouched");
    const abs = resolveContained(root, "docs/a.md", os.homedir()) ?? "";
    swapOut();
    expect(writeVerified(abs, Buffer.from("redirected"), recheck("docs/a.md"))).toBe("escaped");
    expect(readFileSync(path.join(outside, "a.md"), "utf8")).toBe("outside, untouched");
    cleanup();
  });

  // Removing it by name would be a second check-then-act, so the file is left: empty, never written.
  it("writes nothing into a file the redirected open had to create outside", () => {
    const { root, outside, recheck, swapOut, cleanup } = project();
    const abs = resolveContained(root, "docs/new.md", os.homedir()) ?? "";
    swapOut();
    expect(writeVerified(abs, Buffer.from("redirected"), recheck("docs/new.md"))).toBe("escaped");
    expect(readFileSync(path.join(outside, "new.md"), "utf8")).toBe("");
    cleanup();
  });

  it("refuses even when the swap is undone before the check is asked again", () => {
    const { root, outside, recheck, swapOut, swapBack, cleanup } = project();
    writeFileSync(path.join(outside, "a.md"), "outside, untouched");
    const abs = resolveContained(root, "docs/a.md", os.homedir()) ?? "";
    swapOut();
    const recheckAfterSwapBack = () => {
      swapBack();
      return recheck("docs/a.md")();
    };
    expect(writeVerified(abs, Buffer.from("redirected"), recheckAfterSwapBack)).toBe("escaped");
    expect(readFileSync(path.join(outside, "a.md"), "utf8")).toBe("outside, untouched");
    expect(readFileSync(path.join(root, "docs", "a.md"), "utf8")).toBe("inside");
    cleanup();
  });

  // The known limit, pinned so a stronger check shows up as a change here: the identity is looked up by
  // name, so a third swap timed between the re-check and that lookup passes it.
  it("is passed by three swaps timed to the instant (documented limit)", () => {
    const { root, outside, recheck, swapOut, swapBack, cleanup } = project();
    writeFileSync(path.join(outside, "a.md"), "outside");
    const abs = resolveContained(root, "docs/a.md", os.homedir()) ?? "";
    swapOut();
    const recheckThenSwapOutAgain = () => {
      swapBack();
      const contained = recheck("docs/a.md")();
      swapOut();
      return contained;
    };
    expect(writeVerified(abs, Buffer.from("third swap"), recheckThenSwapOutAgain)).toBe("written");
    expect(readFileSync(path.join(outside, "a.md"), "utf8")).toBe("third swap");
    cleanup();
  });

  it.skipIf(process.platform === "win32")("refuses a last component that became a link", () => {
    const { root, outside, cleanup } = project();
    writeFileSync(path.join(outside, "a.md"), "outside, untouched");
    const abs = path.join(root, "docs", "a.md");
    rmSync(abs);
    symlinkSync(path.join(outside, "a.md"), abs);
    expect(writeVerified(abs, Buffer.from("redirected"), () => abs)).toBe("escaped");
    expect(readFileSync(path.join(outside, "a.md"), "utf8")).toBe("outside, untouched");
    cleanup();
  });
});

describe("createFileVerified", () => {
  it("creates an empty file when nothing moved", () => {
    const { root, recheck, cleanup } = project();
    expect(createFileVerified(path.join(root, "docs", "new.md"), recheck("docs/new.md"))).toBe("written");
    expect(readFileSync(path.join(root, "docs", "new.md"), "utf8")).toBe("");
    cleanup();
  });

  it("is passed by three swaps timed to the instant (documented limit)", () => {
    const { root, outside, recheck, swapOut, swapBack, cleanup } = project();
    const abs = resolveContained(root, "docs/new.md", os.homedir()) ?? "";
    swapOut();
    const recheckThenSwapOutAgain = () => {
      swapBack();
      writeFileSync(path.join(root, "docs", "new.md"), ""); // what the check now names must exist to be named
      const contained = recheck("docs/new.md")();
      swapOut();
      return contained;
    };
    expect(createFileVerified(abs, recheckThenSwapOutAgain)).toBe("written");
    expect(readFileSync(path.join(outside, "new.md"), "utf8")).toBe("");
    cleanup();
  });

  it("answers escaped when the folder became a link out after the check", () => {
    const { root, recheck, swapOut, cleanup } = project();
    const abs = resolveContained(root, "docs/new.md", os.homedir()) ?? "";
    swapOut();
    expect(createFileVerified(abs, recheck("docs/new.md"))).toBe("escaped");
    cleanup();
  });
});
