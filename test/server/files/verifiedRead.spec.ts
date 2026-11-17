// @vitest-environment node
import { describe, it, expect } from "vitest";
import { rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { swappableProject as project } from "../../support/swappableProject.js";
import { resolveContained } from "../../../server/files/pathContainment";
import { readVerified, readVerifiedAsync } from "../../../server/files/verifiedRead";

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
