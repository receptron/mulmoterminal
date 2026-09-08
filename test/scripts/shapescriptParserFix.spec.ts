// @vitest-environment node
// The ShapeScript build this host runs on must be one where an unmatched brace is a
// PARSE ERROR, not a hang.
//
// Until shapescript-plugin 1.1.1, `parseShapeScript` spun forever on a `}` with no block
// open: `parseNode()` answers `null` there so a BLOCK's loop can stop, and at the top level
// nothing consumed the token, so the loop never advanced. The parse is SYNCHRONOUS and runs
// in this process, so it did not fail one tool call — it pinned the server. A 4394-character
// agent-written model with one extra `}` on its last line left MulmoTerminal LISTENing on its
// port at 100% CPU, accepting nothing, every `/api/*` request and websocket timing out until
// it was restarted (mulmoclaude#3058).
//
// Why this asserts the VERSION rather than feeding the parser the bad input: the failure is a
// synchronous infinite loop, and `testTimeout` cannot interrupt one — a regression would hang
// the vitest worker rather than fail it, which is the same outage in CI. The behavioural test
// belongs upstream, where it runs against the parser's own source, and it is there. What this
// host can usefully pin is that no build WITHOUT that fix can be the one installed here.
//
// Reads what is INSTALLED as well as what is declared, for the reason mulmoclaudePeerRanges
// gives: a range resolves to one version, and that version is the one that runs.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const PKG = "@mulmoclaude/shapescript-plugin";
/** The first build where an unmatched brace throws instead of looping (mulmoclaude#3058). */
const FLOOR = [1, 1, 1] as const;

const parts = (version: string): number[] =>
  version
    .replace(/^[^\d]*/, "")
    .split(".")
    .map(Number)
    .slice(0, 3);

/** True when `version` is at or above FLOOR. Enough for a floor check on one package's own
 *  release line — no prerelease or range algebra, which is why semver is not pulled in. */
const atLeastFloor = (version: string): boolean => {
  const got = parts(version);
  for (let i = 0; i < FLOOR.length; i++) {
    if ((got[i] ?? 0) !== FLOOR[i]) return (got[i] ?? 0) > FLOOR[i];
  }
  return true;
};

describe("the ShapeScript parser this host runs on", () => {
  it("is installed at 1.1.1 or later, where a stray `}` cannot hang the server", () => {
    const installed = JSON.parse(readFileSync(join(root, "node_modules", PKG, "package.json"), "utf8")) as { version: string };
    expect(atLeastFloor(installed.version), `${PKG} ${installed.version} is installed; 1.1.1+ is required`).toBe(true);
  });

  it("cannot be RE-installed below it — our declared range's floor is 1.1.1 too", () => {
    // A passing test above with a `^1.1.0` range would be luck: the next fresh install is free
    // to resolve 1.1.0 again.
    const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { dependencies?: Record<string, string> };
    const range = manifest.dependencies?.[PKG];
    expect(range, `${PKG} is not a dependency of this package`).toBeTruthy();
    expect(atLeastFloor(range ?? ""), `the declared range ${range ?? ""} admits a build older than 1.1.1`).toBe(true);
  });
});
