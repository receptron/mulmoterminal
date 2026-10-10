// What GET /api/help/sources answers: where THIS MulmoTerminal keeps the things a help session
// reads. A skill asking the server gets the directory the running code was loaded from, so it
// reads the docs and source of the version that is actually running rather than guessing at an
// npx cache path or at whichever checkout happens to be on disk.
import path from "node:path";
import type { InstallKind } from "../../common/updateStatus.js";
import { CHANGELOG_URL, GUIDE_SITE_ORIGIN } from "../../common/whatsNew.js";

export const REPOSITORY_URL = "https://github.com/receptron/mulmoterminal";

export interface HelpSources {
  /** The shipped package.json version. For a git checkout this is the last release, not the build. */
  version: string;
  install: InstallKind;
  /** The npm package, or the git checkout, the running server was loaded from. */
  packageDir: string;
  /** Absolute paths inside packageDir. `src` ships only in a git checkout; the rest are in the package. */
  files: {
    readme: string;
    changelog: string;
    facts: string;
    guideDir: string;
    skillsDir: string;
    serverDir: string;
    commonDir: string;
    srcDir: string;
  };
  urls: {
    guide: string;
    changelog: string;
    repository: string;
    issues: string;
  };
}

export function helpSources(packageDir: string, version: string, install: InstallKind): HelpSources {
  const inPackage = (...segments: string[]): string => path.join(packageDir, ...segments);
  return {
    version,
    install,
    packageDir,
    files: {
      readme: inPackage("README.md"),
      changelog: inPackage("docs", "ChangeLog.md"),
      facts: inPackage("docs", "facts.json"),
      guideDir: inPackage("docs", "guide"),
      skillsDir: inPackage("server", "skills"),
      serverDir: inPackage("server"),
      commonDir: inPackage("common"),
      srcDir: inPackage("src"),
    },
    urls: {
      guide: `${GUIDE_SITE_ORIGIN}/guide/`,
      changelog: CHANGELOG_URL,
      repository: REPOSITORY_URL,
      issues: `${REPOSITORY_URL}/issues`,
    },
  };
}
