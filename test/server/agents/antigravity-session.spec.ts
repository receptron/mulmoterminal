// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  listAntigravitySessions,
  snapshotAntigravitySessions,
  pickFreshAntigravitySession,
  watchForAntigravitySession,
} from "../../../server/agents/antigravity-session.js";

describe("antigravity-session", () => {
  const tmpDir = path.join(os.tmpdir(), `ag-session-test-${Date.now()}`);
  const brainDir = path.join(tmpDir, "brain");

  beforeEach(() => {
    fs.mkdirSync(brainDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("lists valid UUID directories in brain root", () => {
    const uuid1 = "a4dbbf1e-9cba-4879-a84a-d397b47e4f47";
    const uuid2 = "5fd4f183-39d4-4842-8e03-114e966e7fa5";
    fs.mkdirSync(path.join(brainDir, uuid1));
    fs.mkdirSync(path.join(brainDir, uuid2));
    fs.mkdirSync(path.join(brainDir, "not-a-uuid"));

    const sessions = listAntigravitySessions(brainDir);
    expect(sessions).toContain(uuid1);
    expect(sessions).toContain(uuid2);
    expect(sessions).not.toContain("not-a-uuid");
  });

  it("identifies fresh sessions created after snapshot", () => {
    const uuid1 = "a4dbbf1e-9cba-4879-a84a-d397b47e4f47";
    fs.mkdirSync(path.join(brainDir, uuid1));
    const before = snapshotAntigravitySessions(brainDir);

    const uuid2 = "5fd4f183-39d4-4842-8e03-114e966e7fa5";
    fs.mkdirSync(path.join(brainDir, uuid2));

    expect(pickFreshAntigravitySession(brainDir, before)).toBe(uuid2);
  });

  it("watches and discovers a newly created session ID", async () => {
    const before = snapshotAntigravitySessions(brainDir);
    const uuid = "c4f15571-6d41-4d32-9149-72b353fc3d7c";

    setTimeout(() => {
      fs.mkdirSync(path.join(brainDir, uuid));
    }, 50);

    expect(await watchForAntigravitySession(brainDir, before, { pollMs: 20, maxWaitMs: 1000 })).toBe(uuid);
  });
});
