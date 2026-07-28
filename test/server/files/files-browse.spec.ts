import { describe, it, expect } from "vitest";
import { makeTempDir } from "../../support/tempDir.js";
import { writeFileSync, mkdirSync, rmSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import path from "node:path";
import express from "express";
import request from "supertest";
import { currentVersion, listEntries, mdToHtmlDoc, mountFilesBrowseRoutes, MAX_EDIT_BYTES } from "../../../server/files/files-browse";
import { backupDirFor } from "../../../server/files/backup-store";

const tmp = () => makeTempDir("mt-files-");

describe("listEntries", () => {
  it("lists directories first, then files, each alphabetical, with sizes", () => {
    const dir = tmp();
    mkdirSync(path.join(dir, "zsub"));
    mkdirSync(path.join(dir, "asub"));
    writeFileSync(path.join(dir, "b.txt"), "hello");
    writeFileSync(path.join(dir, "a.md"), "# hi");
    const entries = listEntries(dir);
    expect(entries.map((e) => e.name)).toEqual(["asub", "zsub", "a.md", "b.txt"]);
    expect(entries.find((e) => e.name === "b.txt")).toMatchObject({ dir: false, size: 5 });
    expect(entries.find((e) => e.name === "asub")).toMatchObject({ dir: true });
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("mdToHtmlDoc", () => {
  it("wraps body HTML and escapes the title", () => {
    const doc = mdToHtmlDoc("<p>x</p>", "a<b>.md");
    expect(doc).toContain("<p>x</p>");
    expect(doc).toContain("<title>a&lt;b&gt;.md</title>");
    expect(doc.startsWith("<!doctype html>")).toBe(true);
  });

  // The page opens in its own tab under a sandbox CSP, so it cannot ask the app which theme
  // is on — it has to follow the reader's system setting instead of flashing white (#808).
  it("follows the reader's colour scheme", () => {
    const doc = mdToHtmlDoc("<p>x</p>", "a.md");
    expect(doc).toContain("color-scheme:light dark");
    expect(doc).toContain("@media(prefers-color-scheme:dark)");
  });

  // Everything is inlined on purpose: a sandboxed document fetching a stylesheet or a font
  // would be a request the CSP has to allow, for styling that has to work offline anyway.
  it("stays self-contained — no external stylesheet, script or font", () => {
    const doc = mdToHtmlDoc("<p>x</p>", "a.md");
    expect(doc).not.toContain("<link");
    expect(doc).not.toContain("<script");
    expect(doc).not.toMatch(/https?:\/\//);
  });
});

// The editor's write is conditional: the agent working in this very directory edits the same
// files, so a save has to be able to lose the race rather than silently win it.
describe("conditional write", () => {
  const serve = (dir: string, backupRoot = path.join(dir, ".backups")) => {
    const app = express();
    app.use(express.json());
    mountFilesBrowseRoutes(app, { defaultCwd: dir, backupRoot });
    return app;
  };
  const withProject = async (run: (app: express.Express, dir: string) => Promise<void>) => {
    const dir = tmp();
    writeFileSync(path.join(dir, "a.md"), "one");
    try {
      await run(serve(dir), dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
  const query = (dir: string, file = "a.md") => `cwd=${encodeURIComponent(dir)}&path=${encodeURIComponent(file)}`;

  // The editor asks this every 30 seconds per open file; answering with the whole file would
  // ship it all to answer a 16-character question.
  it("answers the version alone, matching the one served with the text", async () => {
    await withProject(async (app, dir) => {
      const { body: read } = await request(app).get(`/api/files/browse/text?${query(dir)}`);
      const res = await request(app).get(`/api/files/browse/version?${query(dir)}`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ version: read.version });

      writeFileSync(path.join(dir, "a.md"), "the agent's version");
      const after = await request(app).get(`/api/files/browse/version?${query(dir)}`);
      expect(after.body.version).not.toBe(read.version);
    });
  });

  // The poll runs every 30 seconds per open file. Hashing whatever it finds would turn "the
  // file was replaced by a huge one" into repeated full reads, for a file the editor could no
  // longer open or save anyway.
  it("refuses to hash a file past the edit cap", async () => {
    await withProject(async (app, dir) => {
      writeFileSync(path.join(dir, "a.md"), "x".repeat(MAX_EDIT_BYTES + 1));
      const res = await request(app).get(`/api/files/browse/version?${query(dir)}`);
      expect(res.status).toBe(413);
    });
  });

  it("reports a missing file as no version, rather than failing", async () => {
    await withProject(async (app, dir) => {
      const res = await request(app).get(`/api/files/browse/version?${query(dir, "nope.md")}`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ version: null });
    });
  });

  it("hands the editor a version with the text", async () => {
    await withProject(async (app, dir) => {
      const res = await request(app).get(`/api/files/browse/text?${query(dir)}`);
      expect(res.status).toBe(200);
      expect(res.body.text).toBe("one");
      expect(typeof res.body.version).toBe("string");
    });
  });

  it("writes when the base version still matches, and reports the new one", async () => {
    await withProject(async (app, dir) => {
      const { body: read } = await request(app).get(`/api/files/browse/text?${query(dir)}`);
      const res = await request(app)
        .put(`/api/files/browse/write?${query(dir)}`)
        .send({ text: "two", baseVersion: read.version });
      expect(res.status).toBe(200);
      expect(readFileSync(path.join(dir, "a.md"), "utf8")).toBe("two");
      // The response's version is the one to save against next, without re-reading.
      expect(res.body.version).not.toBe(read.version);
      const { body: reread } = await request(app).get(`/api/files/browse/text?${query(dir)}`);
      expect(reread.version).toBe(res.body.version);
    });
  });

  it("refuses with 409 — and writes nothing — when the file moved on", async () => {
    await withProject(async (app, dir) => {
      const { body: read } = await request(app).get(`/api/files/browse/text?${query(dir)}`);
      writeFileSync(path.join(dir, "a.md"), "the agent's version");

      const res = await request(app)
        .put(`/api/files/browse/write?${query(dir)}`)
        .send({ text: "my edit", baseVersion: read.version });
      expect(res.status).toBe(409);
      expect(readFileSync(path.join(dir, "a.md"), "utf8")).toBe("the agent's version");

      // The 409 carries the version now on disk, so a deliberate overwrite is one retry away.
      const forced = await request(app)
        .put(`/api/files/browse/write?${query(dir)}`)
        .send({ text: "my edit", baseVersion: res.body.version });
      expect(forced.status).toBe(200);
      expect(readFileSync(path.join(dir, "a.md"), "utf8")).toBe("my edit");
    });
  });

  it("treats a same-content rewrite as no conflict", async () => {
    await withProject(async (app, dir) => {
      const { body: read } = await request(app).get(`/api/files/browse/text?${query(dir)}`);
      writeFileSync(path.join(dir, "a.md"), "one"); // changed and changed back
      const res = await request(app)
        .put(`/api/files/browse/write?${query(dir)}`)
        .send({ text: "two", baseVersion: read.version });
      expect(res.status).toBe(200);
    });
  });

  it("rejects a write with no baseVersion at all — there is no blind-write escape hatch", async () => {
    await withProject(async (app, dir) => {
      const res = await request(app)
        .put(`/api/files/browse/write?${query(dir)}`)
        .send({ text: "two" });
      expect(res.status).toBe(400);
      expect(readFileSync(path.join(dir, "a.md"), "utf8")).toBe("one");
    });
  });

  it("creates a new file when baseVersion is null, and 409s if something got there first", async () => {
    await withProject(async (app, dir) => {
      const created = await request(app)
        .put(`/api/files/browse/write?${query(dir, "new.md")}`)
        .send({ text: "fresh", baseVersion: null });
      expect(created.status).toBe(200);
      expect(readFileSync(path.join(dir, "new.md"), "utf8")).toBe("fresh");

      const again = await request(app)
        .put(`/api/files/browse/write?${query(dir, "new.md")}`)
        .send({ text: "clobber", baseVersion: null });
      expect(again.status).toBe(409);
      expect(readFileSync(path.join(dir, "new.md"), "utf8")).toBe("fresh");
    });
  });
});

// null is the token for "there is no file here", and a caller sends it to mean "I expect to
// be creating this". Anything that merely FAILS TO READ an existing file must not answer null,
// or that write sails past the conflict check and overwrites what it couldn't read.
describe("currentVersion", () => {
  it("reports null for a path that isn't there", () => {
    const dir = tmp();
    expect(currentVersion(path.join(dir, "nope.md"))).toBeNull();
    rmSync(dir, { recursive: true, force: true });
  });

  it("throws, rather than reporting null, when the path exists but can't be read", () => {
    const dir = tmp();
    // A directory stands in for "exists, unreadable as a file": chmod is a no-op on Windows,
    // so a permissions-based case couldn't run on the whole CI matrix.
    expect(() => currentVersion(dir)).toThrow();
    rmSync(dir, { recursive: true, force: true });
  });
});

// Every discard the editor performs — a save replacing what the agent wrote, a conflict the
// user resolves by dropping one side — happens to content nobody deliberately threw away.
describe("browse routes keep backups", () => {
  const withStore = async (run: (app: express.Express, dir: string, backups: string) => Promise<void>) => {
    const dir = makeTempDir("mt-files-");
    const backups = makeTempDir("mt-backups-");
    writeFileSync(path.join(dir, "a.md"), "one");
    const app = express();
    app.use(express.json());
    mountFilesBrowseRoutes(app, { defaultCwd: dir, backupRoot: backups });
    try {
      await run(app, dir, backups);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(backups, { recursive: true, force: true });
    }
  };
  const query = (dir: string, file = "a.md") => `cwd=${encodeURIComponent(dir)}&path=${encodeURIComponent(file)}`;
  // realpath: the server resolves the path it is given, and on macOS a tmpdir under /var IS
  // /private/var — hashing the un-resolved one looks in a directory that will never exist.
  const generations = (backups: string, dir: string, file = "a.md") => {
    const store = backupDirFor(realpathSync(path.join(dir, file)), backups);
    return readdirSync(store)
      .filter((n) => n.endsWith(".bak"))
      .sort()
      .map((n) => readFileSync(path.join(store, n), "utf8"));
  };

  it("banks the file when it is opened", async () => {
    await withStore(async (app, dir, backups) => {
      await request(app).get(`/api/files/browse/text?${query(dir)}`);
      expect(generations(backups, dir)).toEqual(["one"]);
    });
  });

  it("banks what a write is about to replace", async () => {
    await withStore(async (app, dir, backups) => {
      const { body } = await request(app).get(`/api/files/browse/text?${query(dir)}`);
      await request(app)
        .put(`/api/files/browse/write?${query(dir)}`)
        .send({ text: "two", baseVersion: body.version });
      // "one" was banked once at open; the write finds the same content and doesn't re-bank it.
      expect(generations(backups, dir)).toEqual(["one"]);

      const reread = await request(app).get(`/api/files/browse/text?${query(dir)}`);
      await request(app)
        .put(`/api/files/browse/write?${query(dir)}`)
        .send({ text: "three", baseVersion: reread.body.version });
      expect(generations(backups, dir)).toEqual(["one", "two"]);
    });
  });

  it("keeps three generations, oldest first out", async () => {
    await withStore(async (app, dir, backups) => {
      for (const text of ["two", "three", "four", "five"]) {
        const { body } = await request(app).get(`/api/files/browse/text?${query(dir)}`);
        await request(app)
          .put(`/api/files/browse/write?${query(dir)}`)
          .send({ text, baseVersion: body.version });
      }
      expect(generations(backups, dir)).toEqual(["two", "three", "four"]);
    });
  });

  // The conflict banner's "Reload" drops content that only ever existed in the editor.
  it("banks a buffer the client hands over", async () => {
    await withStore(async (app, dir, backups) => {
      const res = await request(app)
        .put(`/api/files/browse/backup?${query(dir)}`)
        .send({ text: "only in the editor" });
      expect(res.status).toBe(200);
      expect(res.body.stored).toBe(true);
      expect(generations(backups, dir)).toContain("only in the editor");
    });
  });

  // Refusing a save because the BACKUP failed would be exactly backwards.
  it("still reads and writes when the backup store is unusable", async () => {
    const dir = makeTempDir("mt-files-");
    writeFileSync(path.join(dir, "a.md"), "one");
    const blocked = path.join(dir, "blocked");
    writeFileSync(blocked, "a file where the backup root should be");
    const app = express();
    app.use(express.json());
    mountFilesBrowseRoutes(app, { defaultCwd: dir, backupRoot: blocked });

    const read = await request(app).get(`/api/files/browse/text?${query(dir)}`);
    expect(read.status).toBe(200);
    const written = await request(app)
      .put(`/api/files/browse/write?${query(dir)}`)
      .send({ text: "two", baseVersion: read.body.version });
    expect(written.status).toBe(200);
    expect(readFileSync(path.join(dir, "a.md"), "utf8")).toBe("two");
    rmSync(dir, { recursive: true, force: true });
  });
});
