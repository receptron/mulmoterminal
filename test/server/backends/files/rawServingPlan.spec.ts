// @vitest-environment node
import { describe, it, expect } from "vitest";

import { SOURCE_CODE_EXTENSIONS } from "../../../../common/sourceExtensions.js";
import { rawServingPlan } from "../../../../server/backends/files/rawServingPlan.js";

const TEXT_PLAIN = "text/plain; charset=utf-8";

const KB = 1024,
  MB = 1024 * KB;

describe("rawServingPlan — content type", () => {
  it.each([
    ["/w/a.png", "image/png"],
    ["/w/a.JPG", "image/jpeg"],
    ["/w/a.svg", "image/svg+xml"],
    ["/w/a.pdf", "application/pdf"],
    ["/w/a.mp4", "video/mp4"],
    ["/w/a.json", "application/json; charset=utf-8"],
  ])("maps %s to %s", (p, ct) => {
    expect(rawServingPlan(p, 1).contentType).toBe(ct);
  });

  // Source / docs / config files are served as text so a terminal file-path link VIEWS them in
  // the browser instead of downloading. Case-insensitive on the extension.
  it.each(["/w/a.md", "/w/a.ts", "/w/a.TS", "/w/a.tsx", "/w/a.js", "/w/a.py", "/w/a.sh", "/w/a.yml", "/w/a.toml", "/w/a.html", "/w/a.css", "/w/a.log"])(
    "serves %s as viewable text/plain",
    (p) => {
      expect(rawServingPlan(p, 1).contentType).toBe("text/plain; charset=utf-8");
    },
  );

  // Dotfiles have an empty `path.extname`, so they must be matched by basename.
  it.each(["/w/.gitignore", "/w/.dockerignore", "/w/.editorconfig", "/w/.env", "/w/proj/.GITIGNORE"])("serves the dotfile %s as viewable text/plain", (p) => {
    expect(rawServingPlan(p, 1).contentType).toBe("text/plain; charset=utf-8");
  });

  it("falls back to octet-stream for a genuinely unknown extension (still downloads)", () => {
    expect(rawServingPlan("/w/a.xyz", 1).contentType).toBe("application/octet-stream");
    expect(rawServingPlan("/w/a.bin", 1).contentType).toBe("application/octet-stream");
    expect(rawServingPlan("/w/noext", 1).contentType).toBe("application/octet-stream");
  });
});

describe("rawServingPlan — the sandbox boundary", () => {
  // The security-relevant branch, and the one the route's single .png test never exercised.
  // An SVG can carry inline <script>; served without the sandbox it runs in the app origin.
  it("sandboxes an SVG", () => {
    expect(rawServingPlan("/w/x.svg", 1).sandbox).toBe(true);
  });

  it("sandboxes an image, a text file, and an unknown type", () => {
    for (const p of ["/w/x.png", "/w/x.txt", "/w/x.xyz"]) expect(rawServingPlan(p, 1).sandbox).toBe(true);
  });

  // The deliberate exceptions. WebKit won't render a sandbox-opaque PDF.
  it("does NOT sandbox a PDF", () => {
    expect(rawServingPlan("/w/x.pdf", 1).sandbox).toBe(false);
  });

  // Chrome's media page re-fetches the file from the sandbox's `null` origin, CORS blocks it, and
  // the player opens with nothing to play — a collection's MP3 link did exactly that.
  it.each(["/w/x.mp3", "/w/x.m4a", "/w/x.wav", "/w/x.ogg", "/w/x.mp4", "/w/x.webm", "/w/X.MOV"])("does NOT sandbox the media file %s", (p) => {
    expect(rawServingPlan(p, 1).sandbox).toBe(false);
  });

  it("still sandboxes everything that is not a PDF or media", () => {
    for (const p of ["/w/x.json", "/w/x.gif", "/w/x.html", "/w/x.svg"]) expect(rawServingPlan(p, 1).sandbox).toBe(true);
  });
});

describe("rawServingPlan — the size cap", () => {
  const GB = 1024 * MB;

  it("holds an image right at the 25 MiB cap", () => {
    expect(rawServingPlan("/w/x.png", 25 * MB).tooLarge).toBe(false);
    expect(rawServingPlan("/w/x.png", 25 * MB + 1).tooLarge).toBe(true);
  });

  it("caps a text file and an unknown type the same way", () => {
    for (const p of ["/w/x.log", "/w/x.xyz", "/w/noext"]) expect(rawServingPlan(p, 25 * MB + 1).tooLarge).toBe(true);
  });

  // Streamed, so size is not a memory question — and a screen recording passes any fixed cap.
  it.each(["/w/x.mp4", "/w/x.webm", "/w/x.mov", "/w/x.mp3", "/w/x.m4a", "/w/x.wav", "/w/x.ogg", "/w/x.pdf", "/w/X.PDF"])(
    "never 413s %s, however large",
    (p) => {
      expect(rawServingPlan(p, 25 * MB + 1).tooLarge).toBe(false);
      expect(rawServingPlan(p, 8 * GB).tooLarge).toBe(false);
    },
  );
});

// The shared source list is only HALF of what this module serves as text (#826). Pinning
// both halves here is what keeps a later "tidy-up" from folding the server's own extras
// into the shared list — which would change what the CLIENT opens in its Files view.
describe("rawServingPlan — the shared source list vs this module's own extras", () => {
  it.each([...SOURCE_CODE_EXTENSIONS])("serves the shared source extension %s as text", (ext) => {
    expect(rawServingPlan(`/w/file${ext}`, 1).contentType).toBe(TEXT_PLAIN);
  });

  // Prose, markup and the languages the client's in-app viewer doesn't claim. These are
  // deliberately NOT in the shared list: the client sends .md to the rendered markdown
  // route and .html to a URL, so promoting them here would silently move both.
  it.each([".md", ".markdown", ".rst", ".adoc", ".mdx", ".pl", ".r", ".dart", ".ex", ".exs", ".env", ".properties", ".html", ".htm"])(
    "serves %s as text without it being in the shared list",
    (ext) => {
      expect(rawServingPlan(`/w/file${ext}`, 1).contentType).toBe(TEXT_PLAIN);
      expect(SOURCE_CODE_EXTENSIONS).not.toContain(ext);
    },
  );

  // `path.extname` is "" for these, so they only match via the basename fallback.
  it.each([".gitignore", ".dockerignore", ".editorconfig"])("serves the dotfile %s as text by basename", (name) => {
    expect(rawServingPlan(`/w/${name}`, 1).contentType).toBe(TEXT_PLAIN);
    expect(SOURCE_CODE_EXTENSIONS).not.toContain(name);
  });

  // .txt is the client's own extra: MIME_BY_EXT already types it here, so it must NOT be
  // added to the shared list to "fix" the asymmetry.
  it("types .txt through the mime table rather than the shared list", () => {
    expect(rawServingPlan("/w/a.txt", 1).contentType).toBe(TEXT_PLAIN);
    expect(SOURCE_CODE_EXTENSIONS).not.toContain(".txt");
  });
});
