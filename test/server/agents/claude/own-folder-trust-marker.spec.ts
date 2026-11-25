// @vitest-environment node
// The trust marker skips a config file it already trusted, and asks again once that file is a
// different one or has changed (#3498).
import { describe, it, expect, afterEach } from "vitest";
import { linkSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { folderTrustMarker } from "../../../../server/agents/claude/own-folder-trust";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

function setup() {
  const root = mkdtempSync(path.join(tmpdir(), "mt-trust-marker-"));
  dirs.push(root);
  const config = path.join(root, ".claude.json");
  writeFileSync(config, "{}");
  const asked: string[] = [];
  const mark = folderTrustMarker((configFile) => {
    asked.push(configFile);
    return "trusted";
  });
  return { root, config, asked, mark };
}

describe("folderTrustMarker", () => {
  it("asks once for a file it already trusted", () => {
    const { config, asked, mark } = setup();
    mark(config, "/w");
    mark(config, "/w");
    expect(asked).toHaveLength(1);
  });

  it("asks again once another file took the name", () => {
    const { config, asked, mark } = setup();
    mark(config, "/w");
    linkSync(config, `${config}.kept`); // keeps the old file alive, so the new one gets its own id
    rmSync(config);
    writeFileSync(config, "{}");
    mark(config, "/w");
    expect(asked).toHaveLength(2);
  });

  it("asks again once the file changed", () => {
    const { config, asked, mark } = setup();
    mark(config, "/w");
    writeFileSync(config, '{"projects":{}}');
    mark(config, "/w");
    expect(asked).toHaveLength(2);
  });
});
