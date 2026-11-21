// @vitest-environment node
// The files an instruction file names (#3332), and which of them are not there.
import { describe, it, expect, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { linkTargets, namedPaths } from "../../../../server/backends/library/instruction-references";
import { missingPaths } from "../../../../server/backends/library/instruction-files-read";

describe("linkTargets", () => {
  it("takes relative link targets outside code, without their anchor", () => {
    expect(linkTargets("See [guide](docs/guide.md#setup), [site](https://x.dev), [mail](mailto:a@b), [here](#top), `[code](no.md)`")).toEqual([
      "docs/guide.md",
    ]);
  });
});

describe("namedPaths", () => {
  it("names links and code-span paths, each in the file's folder and the working directory", () => {
    expect(namedPaths("[a](docs/a.md) and `src/b.ts`", "/w/app/sub/CLAUDE.md", "/w/app", "/h", false)).toEqual([
      { reference: "docs/a.md", candidates: ["/w/app/sub/docs/a.md", "/w/app/docs/a.md"] },
      { reference: "src/b.ts", candidates: ["/w/app/sub/src/b.ts", "/w/app/src/b.ts"] },
    ]);
  });
  it("leaves out placeholders and a tool's own dot-folder, as examples rather than this project's files", () => {
    const text = "`plans/fix-xxx.md` `images/foo.png` `.cursor/mcp.json` `.mulmoterminal/config.json` `docs/real.md`";
    expect(namedPaths(text, "/w/CLAUDE.md", "/w", "/h", false).map((named) => named.reference)).toEqual(["docs/real.md"]);
  });
});

describe("missingPaths", () => {
  const dirs: string[] = [];
  afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));
  it("is the paths in none of their places, never one on a network share", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "mt-references-"));
    dirs.push(root);
    mkdirSync(path.join(root, "docs"), { recursive: true });
    writeFileSync(path.join(root, "docs", "here.md"), "");
    const at = (relative: string) => path.join(root, relative);
    expect(
      await missingPaths([
        { reference: "docs/here.md", candidates: [at("sub/docs/here.md"), at("docs/here.md")] },
        { reference: "docs/gone.md", candidates: [at("docs/gone.md")] },
        { reference: "//server/share/x.md", candidates: ["//server/share/x.md"] },
      ]),
    ).toEqual(["docs/gone.md"]);
  });
});
