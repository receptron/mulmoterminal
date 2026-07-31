import { describe, it, expect, afterEach } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { removeQuietly, removeLegacySandboxDir } from "../../../server/infra/fs-cleanup";

const dirs: string[] = [];
const tmp = () => {
  const dir = mkdtempSync(path.join(tmpdir(), "mt-cleanup-"));
  dirs.push(dir);
  return dir;
};
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

describe("removeQuietly", () => {
  it("removes a file and says it did", () => {
    const dir = tmp();
    const file = path.join(dir, "a.json");
    writeFileSync(file, "{}");
    expect(removeQuietly(file)).toBe(true);
    expect(existsSync(file)).toBe(false);
  });

  it("removes a whole tree", () => {
    const dir = tmp();
    mkdirSync(path.join(dir, "skills", "nested"), { recursive: true });
    writeFileSync(path.join(dir, "skills", "nested", "SKILL.md"), "x");
    expect(removeQuietly(path.join(dir, "skills"))).toBe(true);
    expect(existsSync(path.join(dir, "skills"))).toBe(false);
  });

  // Every caller is cleanup after the work it belongs to has finished or failed, so "it was
  // not there" is the normal case, not an error.
  it("is a no-op for something that was never there", () => {
    expect(removeQuietly(path.join(tmp(), "never-existed"))).toBe(true);
  });

  // The reason this exists: on Windows a file another process still holds fails with
  // EPERM/EBUSY rather than being unlinked, and a throw out of a cleanup turns a transient
  // lock into a broken teardown — a reap that stops halfway, a boot that gives up seeding.
  // POSIX cannot produce that lock, so the failure path is driven directly.
  it("reports a failure instead of throwing it", () => {
    const locked = () => {
      const err = new Error("EBUSY: resource busy or locked") as NodeJS.ErrnoException;
      err.code = "EBUSY";
      throw err;
    };
    expect(() => removeQuietly("C:\\held\\by\\claude.json", locked)).not.toThrow();
    expect(removeQuietly("C:\\held\\by\\claude.json", locked)).toBe(false);
  });

  it("says it succeeded when the removal went through", () => {
    expect(removeQuietly("anything", () => {})).toBe(true);
  });
});

// The Docker sandbox exported a Keychain OAuth credential per session into
// ~/.mulmoterminal/sandbox (mode 0600), and the only thing that ever deleted one was the sandbox's
// own cleanup — which went with the feature. Without this, anyone whose server was killed or
// upgraded mid-session keeps a live credential in a directory nothing will touch again
// (Codex, PR #1195).
describe("removeLegacySandboxDir", () => {
  it("removes the directory and the credentials in it", () => {
    const home = tmp();
    const sandbox = path.join(home, "sandbox");
    mkdirSync(sandbox, { recursive: true });
    writeFileSync(path.join(sandbox, "creds-abc.json"), '{"accessToken":"secret"}');

    expect(removeLegacySandboxDir(home)).toBe(true);
    expect(existsSync(sandbox)).toBe(false);
  });

  it("is happy when there is nothing to remove, so it can run on every boot", () => {
    // The usual case by far: nobody ever turned the sandbox on. It runs unguarded at startup, so
    // a throw here would be a boot failure over a directory that was never created.
    const home = tmp();
    expect(() => removeLegacySandboxDir(home)).not.toThrow();
    expect(removeLegacySandboxDir(home)).toBe(true);
  });

  it("touches nothing else under the home directory", () => {
    const home = tmp();
    mkdirSync(path.join(home, "sandbox"), { recursive: true });
    writeFileSync(path.join(home, "config.json"), "{}");
    mkdirSync(path.join(home, "toolresults"), { recursive: true });

    removeLegacySandboxDir(home);

    expect(existsSync(path.join(home, "config.json"))).toBe(true);
    expect(existsSync(path.join(home, "toolresults"))).toBe(true);
  });
});
