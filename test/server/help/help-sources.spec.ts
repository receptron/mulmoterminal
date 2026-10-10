// @vitest-environment node
import { describe, it, expect } from "vitest";
import path from "node:path";
import { helpSources, REPOSITORY_URL } from "../../../server/help/help-sources.js";
import { CHANGELOG_URL, GUIDE_SITE_ORIGIN } from "../../../common/whatsNew.js";

const PACKAGE_DIR = path.join(path.sep, "opt", "mulmoterminal");

describe("helpSources", () => {
  it("places every file inside the package directory it was given", () => {
    const { files } = helpSources(PACKAGE_DIR, "9.7.0", "npm");
    Object.values(files).forEach((file) => expect(file.startsWith(PACKAGE_DIR + path.sep)).toBe(true));
    expect(files.readme).toBe(path.join(PACKAGE_DIR, "README.md"));
    expect(files.changelog).toBe(path.join(PACKAGE_DIR, "docs", "ChangeLog.md"));
    expect(files.facts).toBe(path.join(PACKAGE_DIR, "docs", "facts.json"));
    expect(files.guideDir).toBe(path.join(PACKAGE_DIR, "docs", "guide"));
    expect(files.skillsDir).toBe(path.join(PACKAGE_DIR, "server", "skills"));
  });

  it("carries the version and install kind through unchanged", () => {
    expect(helpSources(PACKAGE_DIR, "1.2.3", "git")).toMatchObject({ version: "1.2.3", install: "git", packageDir: PACKAGE_DIR });
  });

  // The URLs are the same constants the app shows elsewhere (the What's new dialog, Settings'
  // release notes), so a skill and a user land on one site rather than two.
  it("points at the published guide, the changelog on GitHub and the repository", () => {
    const { urls } = helpSources(PACKAGE_DIR, "9.7.0", "npm");
    expect(urls.guide).toBe(`${GUIDE_SITE_ORIGIN}/guide/`);
    expect(urls.changelog).toBe(CHANGELOG_URL);
    expect(urls.repository).toBe(REPOSITORY_URL);
    expect(urls.issues).toBe(`${REPOSITORY_URL}/issues`);
  });
});
