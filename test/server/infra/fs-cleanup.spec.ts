import { describe, it, expect, afterEach } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { removeQuietly, removeLegacySandboxCredentials } from "../../../server/infra/fs-cleanup";

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
describe("removeLegacySandboxCredentials", () => {
  const sandboxDir = (home: string) => path.join(home, "sandbox");

  it("deletes the credential files", () => {
    const home = tmp();
    mkdirSync(sandboxDir(home), { recursive: true });
    writeFileSync(path.join(sandboxDir(home), "creds-abc.json"), '{"accessToken":"secret"}');

    expect(removeLegacySandboxCredentials(home)).toBe(true);
    expect(existsSync(path.join(sandboxDir(home), "creds-abc.json"))).toBe(false);
  });

  // The directory OUTLIVES the credentials on purpose: it is what remembers that a container sweep
  // is still owed. Removing both at once made the migration one-shot — a first boot with Docker not
  // yet up would lose the sweep forever, and an orphan container would outlive every later start.
  it("keeps the directory, because the container sweep has not answered yet", () => {
    const home = tmp();
    mkdirSync(sandboxDir(home), { recursive: true });
    writeFileSync(path.join(sandboxDir(home), "creds-abc.json"), "{}");

    removeLegacySandboxCredentials(home);

    expect(existsSync(sandboxDir(home))).toBe(true);
  });

  it("keeps answering true while the directory is still there, so the sweep is retried", () => {
    const home = tmp();
    mkdirSync(sandboxDir(home), { recursive: true });
    expect(removeLegacySandboxCredentials(home)).toBe(true);
    expect(removeLegacySandboxCredentials(home)).toBe(true);
  });

  // The premise of this whole file: cleanup must not throw. readdirSync does — EACCES on an
  // unreadable directory, ENOTDIR when the path is a file, ENOENT if it vanishes after the check —
  // and this runs at boot with nobody catching, so an escaping throw is a server that will not
  // start, over litter from a feature that no longer exists (Codex, PR #1195).
  it("does not throw when the path cannot be read, and still reports it was there", () => {
    const home = tmp();
    writeFileSync(sandboxDir(home), "not a directory"); // readdirSync answers ENOTDIR

    expect(() => removeLegacySandboxCredentials(home)).not.toThrow();
    expect(removeLegacySandboxCredentials(home)).toBe(true);
  });

  it("answers FALSE when the directory was never there", () => {
    // Not a detail: the answer is what gates the docker call at boot. Reporting true for a machine
    // that never ran the sandbox — nearly every machine, since it was opt-in and macOS-only —
    // would invoke docker on every start for nothing.
    const home = tmp();
    expect(() => removeLegacySandboxCredentials(home)).not.toThrow();
    expect(removeLegacySandboxCredentials(home)).toBe(false);
  });

  it("touches nothing else under the home directory", () => {
    const home = tmp();
    mkdirSync(sandboxDir(home), { recursive: true });
    writeFileSync(path.join(home, "config.json"), "{}");
    mkdirSync(path.join(home, "toolresults"), { recursive: true });

    removeLegacySandboxCredentials(home);

    expect(existsSync(path.join(home, "config.json"))).toBe(true);
    expect(existsSync(path.join(home, "toolresults"))).toBe(true);
  });
});
