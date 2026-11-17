// @vitest-environment node
import { describe, it, expect } from "vitest";
import { mkdirSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { makeTempDir } from "../../support/tempDir.js";
import { resolveContained } from "../../../server/files/pathContainment";
import { createFileVerified, writeVerified } from "../../../server/files/verifiedWrite";

// #3306. The check answers, then `docs` is swapped for a link out before the file is opened: what a
// route does next must not reach the file outside.
const project = () => {
  const top = realpathSync(makeTempDir("mt-verified-"));
  const root = path.join(top, "root");
  const outside = path.join(top, "outside");
  mkdirSync(path.join(root, "docs"), { recursive: true });
  mkdirSync(outside);
  writeFileSync(path.join(root, "docs", "a.md"), "inside");
  const recheck = (rel: string) => () => resolveContained(root, rel, os.homedir());
  // `docs` leads out from here on; the inside folder is kept aside so a swap back can restore it.
  const swapOut = () => {
    renameSync(path.join(root, "docs"), path.join(root, "docs-aside"));
    symlinkSync(outside, path.join(root, "docs"));
  };
  const swapBack = () => {
    rmSync(path.join(root, "docs"));
    renameSync(path.join(root, "docs-aside"), path.join(root, "docs"));
  };
  return { root, outside, recheck, swapOut, swapBack, cleanup: () => rmSync(top, { recursive: true, force: true }) };
};

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

  it("answers escaped when the folder became a link out after the check", () => {
    const { root, recheck, swapOut, cleanup } = project();
    const abs = resolveContained(root, "docs/new.md", os.homedir()) ?? "";
    swapOut();
    expect(createFileVerified(abs, recheck("docs/new.md"))).toBe("escaped");
    cleanup();
  });
});
