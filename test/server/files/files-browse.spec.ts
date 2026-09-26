// @vitest-environment node
import { describe, it, expect } from "vitest";
import { makeTempDir } from "../../support/tempDir.js";
import { writeFileSync, mkdirSync, rmSync, readFileSync, readdirSync, realpathSync, existsSync } from "node:fs";
import path from "node:path";
import express from "express";
import { routeCall, jsonPost } from "../../helpers/routeCall";
import { currentVersion, listEntries, mdToHtmlDoc, mountFilesBrowseRoutes, MAX_EDIT_BYTES } from "../../../server/files/files-browse";
import { backupDirFor } from "../../../server/files/backup-store";

const tmp = () => makeTempDir("mt-files-");

/** The browse routes over one directory, with backups kept inside it. Shared by the route-level
 *  describes below, which had begun to differ only in which url they then called. */
const serveProject = (dir: string) => {
  const app = express();
  app.use(express.json());
  mountFilesBrowseRoutes(app, { defaultCwd: dir, backupRoot: path.join(dir, ".backups") });
  return app;
};

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
      const { body: read } = await routeCall(app)(`/api/files/browse/text?${query(dir)}`);
      const res = await routeCall(app)(`/api/files/browse/version?${query(dir)}`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ version: read.version });

      writeFileSync(path.join(dir, "a.md"), "the agent's version");
      const after = await routeCall(app)(`/api/files/browse/version?${query(dir)}`);
      expect(after.body.version).not.toBe(read.version);
    });
  });

  // The poll runs every 30 seconds per open file. Hashing whatever it finds would turn "the
  // file was replaced by a huge one" into repeated full reads, for a file the editor could no
  // longer open or save anyway.
  it("refuses to hash a file past the edit cap", async () => {
    await withProject(async (app, dir) => {
      writeFileSync(path.join(dir, "a.md"), "x".repeat(MAX_EDIT_BYTES + 1));
      const res = await routeCall(app)(`/api/files/browse/version?${query(dir)}`);
      expect(res.status).toBe(413);
    });
  });

  it("reports a missing file as no version, rather than failing", async () => {
    await withProject(async (app, dir) => {
      const res = await routeCall(app)(`/api/files/browse/version?${query(dir, "nope.md")}`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ version: null });
    });
  });

  it("hands the editor a version with the text", async () => {
    await withProject(async (app, dir) => {
      const res = await routeCall(app)(`/api/files/browse/text?${query(dir)}`);
      expect(res.status).toBe(200);
      expect(res.body.text).toBe("one");
      expect(typeof res.body.version).toBe("string");
    });
  });

  it("writes when the base version still matches, and reports the new one", async () => {
    await withProject(async (app, dir) => {
      const { body: read } = await routeCall(app)(`/api/files/browse/text?${query(dir)}`);
      const res = await routeCall(app)(`/api/files/browse/write?${query(dir)}`, { ...jsonPost({ text: "two", baseVersion: read.version }), method: "PUT" });
      expect(res.status).toBe(200);
      expect(readFileSync(path.join(dir, "a.md"), "utf8")).toBe("two");
      // The response's version is the one to save against next, without re-reading.
      expect(res.body.version).not.toBe(read.version);
      const { body: reread } = await routeCall(app)(`/api/files/browse/text?${query(dir)}`);
      expect(reread.version).toBe(res.body.version);
    });
  });

  it("refuses with 409 — and writes nothing — when the file moved on", async () => {
    await withProject(async (app, dir) => {
      const { body: read } = await routeCall(app)(`/api/files/browse/text?${query(dir)}`);
      writeFileSync(path.join(dir, "a.md"), "the agent's version");

      const res = await routeCall(app)(`/api/files/browse/write?${query(dir)}`, { ...jsonPost({ text: "my edit", baseVersion: read.version }), method: "PUT" });
      expect(res.status).toBe(409);
      expect(readFileSync(path.join(dir, "a.md"), "utf8")).toBe("the agent's version");

      // The 409 carries the version now on disk, so a deliberate overwrite is one retry away.
      const forced = await routeCall(app)(`/api/files/browse/write?${query(dir)}`, {
        ...jsonPost({ text: "my edit", baseVersion: res.body.version }),
        method: "PUT",
      });
      expect(forced.status).toBe(200);
      expect(readFileSync(path.join(dir, "a.md"), "utf8")).toBe("my edit");
    });
  });

  it("treats a same-content rewrite as no conflict", async () => {
    await withProject(async (app, dir) => {
      const { body: read } = await routeCall(app)(`/api/files/browse/text?${query(dir)}`);
      writeFileSync(path.join(dir, "a.md"), "one"); // changed and changed back
      const res = await routeCall(app)(`/api/files/browse/write?${query(dir)}`, { ...jsonPost({ text: "two", baseVersion: read.version }), method: "PUT" });
      expect(res.status).toBe(200);
    });
  });

  it("rejects a write with no baseVersion at all — there is no blind-write escape hatch", async () => {
    await withProject(async (app, dir) => {
      const res = await routeCall(app)(`/api/files/browse/write?${query(dir)}`, { ...jsonPost({ text: "two" }), method: "PUT" });
      expect(res.status).toBe(400);
      expect(readFileSync(path.join(dir, "a.md"), "utf8")).toBe("one");
    });
  });

  it("creates a new file when baseVersion is null, and 409s if something got there first", async () => {
    await withProject(async (app, dir) => {
      const created = await routeCall(app)(`/api/files/browse/write?${query(dir, "new.md")}`, {
        ...jsonPost({ text: "fresh", baseVersion: null }),
        method: "PUT",
      });
      expect(created.status).toBe(200);
      expect(readFileSync(path.join(dir, "new.md"), "utf8")).toBe("fresh");

      const again = await routeCall(app)(`/api/files/browse/write?${query(dir, "new.md")}`, {
        ...jsonPost({ text: "clobber", baseVersion: null }),
        method: "PUT",
      });
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
      await routeCall(app)(`/api/files/browse/text?${query(dir)}`);
      expect(generations(backups, dir)).toEqual(["one"]);
    });
  });

  it("banks what a write is about to replace", async () => {
    await withStore(async (app, dir, backups) => {
      const { body } = await routeCall(app)(`/api/files/browse/text?${query(dir)}`);
      await routeCall(app)(`/api/files/browse/write?${query(dir)}`, { ...jsonPost({ text: "two", baseVersion: body.version }), method: "PUT" });
      // "one" was banked once at open; the write finds the same content and doesn't re-bank it.
      expect(generations(backups, dir)).toEqual(["one"]);

      const reread = await routeCall(app)(`/api/files/browse/text?${query(dir)}`);
      await routeCall(app)(`/api/files/browse/write?${query(dir)}`, { ...jsonPost({ text: "three", baseVersion: reread.body.version }), method: "PUT" });
      expect(generations(backups, dir)).toEqual(["one", "two"]);
    });
  });

  it("keeps three generations, oldest first out", async () => {
    await withStore(async (app, dir, backups) => {
      for (const text of ["two", "three", "four", "five"]) {
        const { body } = await routeCall(app)(`/api/files/browse/text?${query(dir)}`);
        await routeCall(app)(`/api/files/browse/write?${query(dir)}`, { ...jsonPost({ text, baseVersion: body.version }), method: "PUT" });
      }
      expect(generations(backups, dir)).toEqual(["two", "three", "four"]);
    });
  });

  // The conflict banner's "Reload" drops content that only ever existed in the editor.
  it("banks a buffer the client hands over", async () => {
    await withStore(async (app, dir, backups) => {
      const res = await routeCall(app)(`/api/files/browse/backup?${query(dir)}`, { ...jsonPost({ text: "only in the editor" }), method: "PUT" });
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

    const read = await routeCall(app)(`/api/files/browse/text?${query(dir)}`);
    expect(read.status).toBe(200);
    const written = await routeCall(app)(`/api/files/browse/write?${query(dir)}`, {
      ...jsonPost({ text: "two", baseVersion: read.body.version }),
      method: "PUT",
    });
    expect(written.status).toBe(200);
    expect(readFileSync(path.join(dir, "a.md"), "utf8")).toBe("two");
    rmSync(dir, { recursive: true, force: true });
  });
});

// The editor reads with `toString("utf8")`, which replaces every byte it cannot represent — so a
// spreadsheet is already destroyed by the time it reaches the textarea, and one keystroke commits
// the replacement. Measured before the fix: a 324-byte xlsx came back 336 bytes and no longer
// opened as a zip. `MAX_EDIT_BYTES`' own comment always claimed binaries were refused; only the
// size half of it was ever implemented (#2038).
describe("content that cannot be edited as text", () => {
  const ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00, 0x08, 0x00, 0xff, 0xfe]);
  const withFiles = async (run: (app: express.Express, dir: string, backups: string) => Promise<void>) => {
    const dir = tmp();
    const backups = path.join(dir, ".backups");
    writeFileSync(path.join(dir, "book.xlsx"), ZIP);
    writeFileSync(path.join(dir, "notes.txt"), "hello");
    // A NUL byte survives a UTF-8 round trip exactly, so refusing it would be a false alarm —
    // which is what the usual "sniff for NUL" rule would do.
    writeFileSync(path.join(dir, "has-nul.txt"), Buffer.from([0x61, 0x00, 0x62]));
    const app = express();
    app.use(express.json());
    mountFilesBrowseRoutes(app, { defaultCwd: dir, backupRoot: backups });
    try {
      await run(app, dir, backups);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
  const ask = (app: express.Express, dir: string, file: string, route = "text") =>
    routeCall(app)(`/api/files/browse/${route}?cwd=${encodeURIComponent(dir)}&path=${encodeURIComponent(file)}`);
  const write = (app: express.Express, dir: string, body: unknown) =>
    routeCall(app)(`/api/files/browse/write?cwd=${encodeURIComponent(dir)}&path=book.xlsx`, { ...jsonPost(body), method: "PUT" });

  it("refuses bytes the round trip would change, with a kind the pane can switch on", async () => {
    await withFiles(async (app, dir) => {
      const res = await ask(app, dir, "book.xlsx");
      expect(res.status).toBe(415);
      expect(res.body).toMatchObject({ kind: "binary" });
    });
  });

  // The safety net was storing the DAMAGED text, so the refusal has to come before it.
  it("writes no backup for a file it refused", async () => {
    await withFiles(async (app, dir, backups) => {
      await ask(app, dir, "book.xlsx");
      const written = existsSync(backups) ? readdirSync(backupDirFor(path.join(dir, "book.xlsx"), backups)) : [];
      expect(written.filter((name) => name.endsWith(".bak"))).toEqual([]);
    });
  });

  // The read refusal alone was not enough: the editor shows an EMPTY buffer for a file it will not
  // display, and Ctrl+S reaches `save()` even with the button disabled. The first write 409s, and
  // "Overwrite anyway" then re-sends the empty text WITH the current version — which truncated a
  // 324-byte xlsx to 0 (CodeRabbit on #2038). This route only ever receives a string, so writing
  // one over content that is not text is always a loss, whoever asked.
  it("refuses to write text over content that is not text", async () => {
    await withFiles(async (app, dir) => {
      const before = readFileSync(path.join(dir, "book.xlsx"));
      const res = await write(app, dir, { text: "", baseVersion: null });
      expect(res.status).toBe(415);
      expect(readFileSync(path.join(dir, "book.xlsx"))).toEqual(before);
    });
  });

  // Even with the right version in hand — which is exactly what "Overwrite anyway" sends.
  it("refuses the overwrite retry, which carries the version the conflict reported", async () => {
    await withFiles(async (app, dir) => {
      const before = readFileSync(path.join(dir, "book.xlsx"));
      const version = (await ask(app, dir, "book.xlsx", "version")).body.version;
      const res = await write(app, dir, { text: "", baseVersion: version });
      expect(res.status).toBe(415);
      expect(readFileSync(path.join(dir, "book.xlsx"))).toEqual(before);
    });
  });

  // `backupCurrentFile` reads with "utf8", so a backup taken on the way to that write would bank a
  // damaged copy of the file it exists to protect. The refusal has to come first.
  it("banks no backup on the way to a refused write", async () => {
    await withFiles(async (app, dir, backups) => {
      await write(app, dir, { text: "", baseVersion: null });
      const written = existsSync(backups) ? readdirSync(backupDirFor(path.join(dir, "book.xlsx"), backups)) : [];
      expect(written.filter((name) => name.endsWith(".bak"))).toEqual([]);
    });
  });

  it("still serves text, including bytes a binary sniff would have refused", async () => {
    await withFiles(async (app, dir) => {
      expect((await ask(app, dir, "notes.txt")).status).toBe(200);
      expect((await ask(app, dir, "has-nul.txt")).status).toBe(200);
    });
  });
});

// The finder's candidate list (#2099). The listing rules themselves are project-files.spec.ts;
// this is about the route — where it is rooted, and what it does when the root is not there.
describe("GET /api/files/browse/index", () => {
  it("answers with every file under the project, relative to its root", async () => {
    const dir = tmp();
    mkdirSync(path.join(dir, "src"));
    writeFileSync(path.join(dir, "src", "a.ts"), "x");
    writeFileSync(path.join(dir, "b.md"), "y");
    const res = await routeCall(serveProject(dir))(`/api/files/browse/index?cwd=${encodeURIComponent(dir)}`);
    expect(res.status).toBe(200);
    expect(res.body.paths).toEqual(["b.md", "src/a.ts"]);
    expect(res.body.truncated).toBe(false);
  });

  it("falls back to the server's own workspace when no cwd is asked for", async () => {
    const dir = tmp();
    writeFileSync(path.join(dir, "only.txt"), "x");
    const res = await routeCall(serveProject(dir))("/api/files/browse/index");
    expect(res.body.paths).toEqual(["only.txt"]);
  });

  // `?path=` is IGNORED here, unlike every other browse route: the finder hands what it picks to
  // the tree and the editor, which both resolve against the ROOT, so a list relative to some
  // subdirectory would open the wrong file at every depth.
  it("stays rooted at the project even when a path is passed", async () => {
    const dir = tmp();
    mkdirSync(path.join(dir, "sub"));
    writeFileSync(path.join(dir, "sub", "a.ts"), "x");
    writeFileSync(path.join(dir, "top.md"), "y");
    const res = await routeCall(serveProject(dir))(`/api/files/browse/index?cwd=${encodeURIComponent(dir)}&path=sub`);
    expect(res.body.paths).toEqual(["sub/a.ts", "top.md"]);
  });

  // An UNUSABLE `cwd` — relative here, or naming nothing — falls back to the server's default
  // workspace, the same as every other browse route.
  //
  // That is a fallback and NOT a containment guarantee, which the earlier wording of this comment
  // claimed and the code does not do: `resolveBase` accepts any absolute directory that exists.
  // This family of routes is built on the trusted-local-user posture its module header states, and
  // what is actually contained is the `path`, on the routes that take one (Codex on #2102).
  it("falls back to the default workspace when cwd is unusable", async () => {
    const dir = tmp();
    writeFileSync(path.join(dir, "mine.txt"), "x");
    const res = await routeCall(serveProject(dir))("/api/files/browse/index?cwd=not-absolute");
    expect(res.body.paths).toEqual(["mine.txt"]);
  });
});

// #2157. The route serves TWO documents now: the one every caller has always had, and the one the
// Files pane embeds, which carries a script that reports where the reader is. The second exists
// because the first cannot be read from — and the whole design is that asking for the second
// changes nothing about the first.
// #2264. Front matter is metadata; rendered as Markdown, its closing `---` makes the whole block a
// heading under a rule. Both documents the route serves start at the body.
describe("GET /api/files/browse/md — front matter", () => {
  it.each([[""], ["&embed=1"]])("does not render the front matter as body (%s)", async (param) => {
    const dir = tmp();
    writeFileSync(path.join(dir, "a.md"), "---\ntitle: Basics\nlayout: default\n---\n\n# Body\n");
    try {
      const res = await routeCall(serveProject(dir))(`/api/files/browse/md?cwd=${encodeURIComponent(dir)}&path=a.md${param}`);
      expect(res.text).toContain("<h1>Body</h1>");
      expect(res.text).not.toContain("title: Basics");
      expect(res.text).not.toContain("<hr>");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // Only a block that parses as YAML is front matter — the rule the Canvas and MulmoClaude use.
  // A document may open with a thematic break, and a malformed header is better shown than lost.
  it.each([
    ["a rule in the middle of the body", "# Top\n\n---\n\ntitle: kept\n", "title: kept"],
    ["a document that opens with a rule", "---\n# Intro\n---\nbody\n", "Intro"],
    ["a header whose YAML does not parse", "---\ntitle: [unclosed\n---\n# Body\n", "title: [unclosed"],
  ])("keeps %s", async (_case, body, kept) => {
    const dir = tmp();
    writeFileSync(path.join(dir, "a.md"), body);
    try {
      const res = await routeCall(serveProject(dir))(`/api/files/browse/md?cwd=${encodeURIComponent(dir)}&path=a.md`);
      expect(res.text).toContain(kept);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("GET /api/files/browse/md", () => {
  const HOSTILE = '# title\n\n<script>document.title = "ran"</script>\n\n<img src=x onerror="document.title = \'ran\'">\n';
  const withMd = async (body: string, run: (call: ReturnType<typeof routeCall>, query: string) => Promise<void>) => {
    const dir = tmp();
    writeFileSync(path.join(dir, "a.md"), body);
    try {
      await run(routeCall(serveProject(dir)), `cwd=${encodeURIComponent(dir)}&path=a.md`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };

  // The new tab a clicked `.md` in terminal output opens. Its containment is the sandbox, and it
  // is what the embeddable document must not disturb.
  it("serves the plain document under the policy that runs nothing", async () => {
    await withMd(HOSTILE, async (call, query) => {
      const res = await call(`/api/files/browse/md?${query}`);
      expect(res.headers["content-security-policy"]).toBe("sandbox");
      expect(res.text).not.toContain("nonce");
    });
  });

  // The opt-in has to be the exact value, or a policy is loosened by a parameter nobody wrote.
  it.each([["embed=0"], ["embed=true"], ["embed="], ["embedded=1"]])("serves the plain document for ?%s", async (param) => {
    await withMd("# hi\n", async (call, query) => {
      const res = await call(`/api/files/browse/md?${query}&${param}`);
      expect(res.headers["content-security-policy"]).toBe("sandbox");
      expect(res.text).not.toContain("<script");
    });
  });

  it("serves the embeddable document with scripts allowed and no origin", async () => {
    await withMd("# hi\n", async (call, query) => {
      const res = await call(`/api/files/browse/md?${query}&embed=1`);
      const csp = res.headers["content-security-policy"] ?? "";
      expect(csp).toContain("sandbox allow-scripts");
      expect(csp).not.toContain("allow-same-origin");
      expect(res.text).toContain("<script nonce=");
    });
  });

  // The header and the document have to agree, or the one script that is supposed to run does
  // not — which looks exactly like a preview that has forgotten where the reader was.
  it("declares in the document the same nonce it sent in the header", async () => {
    await withMd("# hi\n", async (call, query) => {
      const res = await call(`/api/files/browse/md?${query}&embed=1`);
      const nonce = /nonce-([A-Za-z0-9_-]+)/.exec(res.headers["content-security-policy"] ?? "")?.[1];
      expect(nonce).toBeTruthy();
      expect(res.text).toContain(`<script nonce="${nonce}">`);
    });
  });

  // THE claim of the whole change: the file's own scripts are still in the document and still
  // carry no nonce, so the policy that admits ours refuses every one of them.
  it("leaves the file's own scripts in the document without the nonce that would run them", async () => {
    await withMd(HOSTILE, async (call, query) => {
      const res = await call(`/api/files/browse/md?${query}&embed=1`);
      const nonce = /nonce-([A-Za-z0-9_-]+)/.exec(res.headers["content-security-policy"] ?? "")?.[1] ?? "";
      expect(res.text).toContain('<script>document.title = "ran"</script>');
      expect(res.text).toContain("onerror=");
      expect(res.text.split(nonce)).toHaveLength(2); // the nonce appears once, on our element
    });
  });

  // Two readings of one file must not share a nonce: a document that has seen one response would
  // otherwise be able to name the value that runs a script in the next.
  it("mints a new nonce per response", async () => {
    await withMd("# hi\n", async (call, query) => {
      const [a, b] = await Promise.all([call(`/api/files/browse/md?${query}&embed=1`), call(`/api/files/browse/md?${query}&embed=1`)]);
      expect(a.headers["content-security-policy"]).not.toBe(b.headers["content-security-policy"]);
    });
  });

  // The nonce in the header only means anything while it matches the one in the body, and a
  // cached body is what would separate them. Express derives its ETag from the body, so a body
  // that changes every response cannot be answered with a 304 — pinned here because a later
  // `Cache-Control` on this route would break it with no error anywhere.
  it("cannot be answered out of a cache", async () => {
    await withMd("# hi\n", async (call, query) => {
      const first = await call(`/api/files/browse/md?${query}&embed=1`);
      const again = await call(`/api/files/browse/md?${query}&embed=1`, { headers: { "If-None-Match": first.headers.etag ?? "" } });
      expect(again.status).toBe(200);
      expect(again.headers.etag).not.toBe(first.headers.etag);
      const nonce = /nonce-([A-Za-z0-9_-]+)/.exec(again.headers["content-security-policy"] ?? "")?.[1] ?? "";
      expect(again.text).toContain(`<script nonce="${nonce}">`);
    });
  });

  // The embeddable document is the plain one plus one element — not a second rendering with its
  // own rules. A difference here is a difference the reader sees between the two views.
  it("renders the same document as the plain one", async () => {
    await withMd("# hi\n\n[x](y)\n", async (call, query) => {
      const plain = await call(`/api/files/browse/md?${query}`);
      const embedded = await call(`/api/files/browse/md?${query}&embed=1`);
      expect(embedded.text.replace(/<script nonce="[^"]*">[\s\S]*?<\/script>/, "")).toBe(plain.text);
    });
  });

  // Embedding is per route, not a parameter the whole family answers to.
  it("does not let ?embed=1 loosen the other rendered views", async () => {
    const dir = tmp();
    writeFileSync(path.join(dir, "a.json"), '{"a":1}');
    const res = await routeCall(serveProject(dir))(`/api/files/browse/json?cwd=${encodeURIComponent(dir)}&path=a.json&embed=1`);
    expect(res.headers["content-security-policy"]).toBe("sandbox");
    rmSync(dir, { recursive: true, force: true });
  });
});
