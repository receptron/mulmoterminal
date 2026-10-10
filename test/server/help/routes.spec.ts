// @vitest-environment node
import { describe, it, expect } from "vitest";
import express from "express";
import path from "node:path";
import { routeCall } from "../../helpers/routeCall";
import { mountHelpRoutes } from "../../../server/help/routes.js";

const PACKAGE_DIR = path.join(path.sep, "srv", "mt");

const appWith = (version: string, install: "npm" | "git") => {
  const app = express();
  mountHelpRoutes(app, { packageDir: PACKAGE_DIR, status: () => ({ version, install }) });
  return app;
};

describe("GET /api/help/sources", () => {
  it("answers the running version, the install kind and where the docs are", async () => {
    const res = await routeCall(appWith("9.7.0", "npm"))("/api/help/sources");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      version: "9.7.0",
      install: "npm",
      packageDir: PACKAGE_DIR,
      files: { guideDir: path.join(PACKAGE_DIR, "docs", "guide"), changelog: path.join(PACKAGE_DIR, "docs", "ChangeLog.md") },
    });
  });

  // The status is read per request, not at mount: the version is known at boot but the install kind
  // lands after a git probe, and a skill asking early must not be told the placeholder forever.
  it("reads the status each time it is asked", async () => {
    let install: "npm" | "git" = "npm";
    const app = express();
    mountHelpRoutes(app, { packageDir: PACKAGE_DIR, status: () => ({ version: "9.7.0", install }) });
    const call = routeCall(app);
    expect((await call("/api/help/sources")).body.install).toBe("npm");
    install = "git";
    expect((await call("/api/help/sources")).body.install).toBe("git");
  });
});
