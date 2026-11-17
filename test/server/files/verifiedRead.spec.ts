// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";
import { swappableProject as project } from "../../support/swappableProject.js";
import { resolveContained } from "../../../server/files/pathContainment";
import { openVerifiedForRead, readVerified, readVerifiedAsync } from "../../../server/files/verifiedRead";

const VERIFIED_READ = fileURLToPath(new URL("../../../server/files/verifiedRead.ts", import.meta.url));
const CHILD_DEADLINE_MS = 20_000;

// #3306, the read side: once `docs` has become a link out, none of the outside file's bytes come back.
const readers = [
  { name: "readVerified", read: async (...args: Parameters<typeof readVerified>) => readVerified(...args) },
  { name: "readVerifiedAsync", read: readVerifiedAsync },
];

describe.each(readers)("$name", ({ read }) => {
  it("reads the file when nothing moved", async () => {
    const { root, recheck, cleanup } = project();
    expect((await read(path.join(root, "docs", "a.md"), recheck("docs/a.md")))?.toString()).toBe("inside");
    cleanup();
  });

  it("reads nothing when a folder became a link out after the check", async () => {
    const { root, outside, recheck, swapOut, cleanup } = project();
    writeFileSync(path.join(outside, "a.md"), "outside");
    const abs = resolveContained(root, "docs/a.md", os.homedir()) ?? "";
    swapOut();
    expect(await read(abs, recheck("docs/a.md"))).toBeNull();
    cleanup();
  });

  it("reads nothing even when the swap is undone before the check is asked again", async () => {
    const { root, outside, recheck, swapOut, swapBack, cleanup } = project();
    writeFileSync(path.join(outside, "a.md"), "outside");
    const abs = resolveContained(root, "docs/a.md", os.homedir()) ?? "";
    swapOut();
    const recheckAfterSwapBack = () => {
      swapBack();
      return recheck("docs/a.md")();
    };
    expect(await read(abs, recheckAfterSwapBack)).toBeNull();
    cleanup();
  });

  // The known limit, as for writes: the identity is looked up by name, so a third swap timed between the
  // re-check and that lookup passes it.
  it("is passed by three swaps timed to the instant (documented limit)", async () => {
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
    expect((await read(abs, recheckThenSwapOutAgain))?.toString()).toBe("outside");
    cleanup();
  });

  it("throws ENOENT for a file that is not there, as a plain read would", async () => {
    const { root, recheck, cleanup } = project();
    await expect(read(path.join(root, "docs", "nope.md"), recheck("docs/nope.md"))).rejects.toMatchObject({ code: "ENOENT" });
    cleanup();
  });

  it.skipIf(process.platform === "win32")("refuses a last component that became a link", async () => {
    const { root, outside, cleanup } = project();
    writeFileSync(path.join(outside, "a.md"), "outside");
    const abs = path.join(root, "docs", "a.md");
    rmSync(abs);
    symlinkSync(path.join(outside, "a.md"), abs);
    expect(await read(abs, () => abs)).toBeNull();
    cleanup();
  });
});

describe("openVerifiedForRead", () => {
  const openDescriptors = () => readdirSync("/dev/fd").length;

  it.skipIf(process.platform === "win32")("closes the descriptor when the re-check throws", () => {
    const { root, cleanup } = project();
    const before = openDescriptors();
    const throwing = () => {
      throw new Error("check failed");
    };
    expect(() => openVerifiedForRead(path.join(root, "docs", "a.md"), throwing)).toThrow("check failed");
    expect(openDescriptors()).toBe(before);
    cleanup();
  });

  // In a child with a deadline: a blocking open would hold this worker forever rather than fail.
  it.skipIf(process.platform === "win32")("does not wait for a writer when a FIFO outside was swapped in", () => {
    const { root, outside, swapOut, cleanup } = project();
    execFileSync("/usr/bin/mkfifo", [path.join(outside, "pipe")]);
    writeFileSync(path.join(root, "docs", "pipe"), "inside");
    const abs = resolveContained(root, "docs/pipe", os.homedir()) ?? "";
    swapOut();
    const script = `import { readVerified } from ${JSON.stringify(VERIFIED_READ)}; process.stdout.write(String(readVerified(${JSON.stringify(abs)}, () => ${JSON.stringify(path.join(root, "docs-aside", "pipe"))})));`;
    const child = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], { timeout: CHILD_DEADLINE_MS, encoding: "utf8" });
    expect(child.error).toBeUndefined();
    expect(child.stdout).toBe("null");
    cleanup();
  });
});
