// @vitest-environment node
import { describe, it, expect } from "vitest";
import { escapeHtml, htmlDoc, jsonHtmlDoc, tableHtmlDoc, parseDelimited, delimiterForExtension, themeStyle } from "../../../server/files/renderedDoc";

describe("escapeHtml", () => {
  it("escapes everything that can break out of text or an attribute", () => {
    expect(escapeHtml(`<script>alert("x") & 'y'</script>`)).toBe("&lt;script&gt;alert(&quot;x&quot;) &amp; &#39;y&#39;&lt;/script&gt;");
  });

  it("leaves ordinary text alone", () => {
    expect(escapeHtml("日本語 a-b_c 100%")).toBe("日本語 a-b_c 100%");
  });
});

describe("htmlDoc", () => {
  it("escapes the title and keeps the body", () => {
    const doc = htmlDoc("<p>x</p>", "a<b>.md");
    expect(doc).toContain("<p>x</p>");
    expect(doc).toContain("<title>a&lt;b&gt;.md</title>");
    expect(doc.startsWith("<!doctype html>")).toBe(true);
  });

  // The page opens in its own tab under a sandbox CSP, so it cannot ask the app which theme
  // is on — it follows the reader's system setting instead of flashing white (#808).
  it("follows the reader's colour scheme", () => {
    expect(htmlDoc("", "a")).toContain("color-scheme:light dark");
    expect(htmlDoc("", "a")).toContain("@media(prefers-color-scheme:dark)");
  });

  // A sandboxed document cannot run a script, and should not need a request for anything
  // else either — styling has to work with no network at all.
  it("stays self-contained — no external stylesheet, script or font", () => {
    const doc = htmlDoc("<p>x</p>", "a");
    expect(doc).not.toContain("<link");
    expect(doc).not.toContain("<script");
    expect(doc).not.toMatch(/https?:\/\//);
  });
});

describe("jsonHtmlDoc", () => {
  it("indents the document", () => {
    expect(jsonHtmlDoc('{"a":1,"b":[2,3]}', "x.json")).toContain(`{\n  &quot;a&quot;: 1,\n  &quot;b&quot;: [\n    2,\n    3\n  ]\n}`);
  });

  // A file that does not parse is exactly when someone opens it to look, so it must still be
  // shown — not replaced by an error page.
  it("shows unparseable text as it is", () => {
    expect(jsonHtmlDoc('{"a": oops,,}', "x.json")).toContain("{&quot;a&quot;: oops,,}");
  });

  it("escapes values rather than emitting them as markup", () => {
    const doc = jsonHtmlDoc('{"a":"<img onerror=1>"}', "x.json");
    expect(doc).not.toContain("<img");
    expect(doc).toContain("&lt;img");
  });

  it("renders an empty file without throwing", () => {
    expect(() => jsonHtmlDoc("", "x.json")).not.toThrow();
  });
});

describe("delimiterForExtension", () => {
  it("is a tab for .tsv and a comma otherwise", () => {
    expect(delimiterForExtension(".tsv")).toBe("\t");
    expect(delimiterForExtension(".TSV")).toBe("\t");
    expect(delimiterForExtension(".csv")).toBe(",");
    expect(delimiterForExtension("")).toBe(",");
  });
});

describe("parseDelimited", () => {
  it("splits plain rows and fields", () => {
    expect(parseDelimited("a,b\n1,2", ",")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("handles CRLF as one row break", () => {
    expect(parseDelimited("a,b\r\n1,2\r\n", ",")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("does not start an empty row on a trailing newline", () => {
    expect(parseDelimited("a\n", ",")).toEqual([["a"]]);
  });

  // The whole reason this is not a `split(",")`: a loose parser cuts a quoted field in half
  // and the table silently shows the wrong thing.
  it("keeps a delimiter inside a quoted field", () => {
    expect(parseDelimited('"a,b",c', ",")).toEqual([["a,b", "c"]]);
  });

  it("keeps a newline inside a quoted field", () => {
    expect(parseDelimited('"line1\nline2",c', ",")).toEqual([["line1\nline2", "c"]]);
  });

  it("reads a doubled quote as one literal quote", () => {
    expect(parseDelimited('"say ""hi""",c', ",")).toEqual([['say "hi"', "c"]]);
  });

  it("treats a quote in the middle of an unquoted field as text", () => {
    expect(parseDelimited(`5" pipe,c`, ",")).toEqual([[`5" pipe`, "c"]]);
  });

  // Deliberate, and surprising enough to record: a quote that follows whitespace does NOT
  // open a quoted field, so this row splits at the inner comma. That is RFC 4180, and it is
  // what Python's `csv.reader` produces for the same input (checked against it) — matching
  // the reference implementation matters more here than guessing at the author's intent.
  it("does not treat a quote after leading spaces as opening a field", () => {
    expect(parseDelimited('a,  "b,c"', ",")).toEqual([["a", '  "b', 'c"']]);
  });

  it("keeps empty fields, including a trailing one", () => {
    expect(parseDelimited("a,,c,", ",")).toEqual([["a", "", "c", ""]]);
  });

  it("splits on tabs when that is the delimiter", () => {
    expect(parseDelimited("a\tb\n1\t2", "\t")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("returns no rows for an empty file", () => {
    expect(parseDelimited("", ",")).toEqual([]);
  });

  // A truncated file is exactly when someone opens the viewer, so the rest is kept rather
  // than dropped on the floor.
  it("takes the rest of the file when a quote is never closed", () => {
    expect(parseDelimited('a,"unterminated', ",")).toEqual([["a", "unterminated"]]);
  });

  it("keeps rows of differing length as they are, rather than padding", () => {
    expect(parseDelimited("a,b,c\n1,2", ",")).toEqual([
      ["a", "b", "c"],
      ["1", "2"],
    ]);
  });
});

describe("tableHtmlDoc", () => {
  it("uses the first row as the header", () => {
    const doc = tableHtmlDoc("name,size\na.txt,10", "x.csv", ",");
    expect(doc).toContain("<thead><tr><th>name</th><th>size</th></tr></thead>");
    expect(doc).toContain("<tbody><tr><td>a.txt</td><td>10</td></tr></tbody>");
  });

  it("escapes cell values", () => {
    const doc = tableHtmlDoc('h\n"<b>x</b>"', "x.csv", ",");
    expect(doc).not.toContain("<b>x</b>");
    expect(doc).toContain("&lt;b&gt;x&lt;/b&gt;");
  });

  it("says so for an empty file instead of drawing an empty frame", () => {
    const doc = tableHtmlDoc("", "x.csv", ",");
    expect(doc).toContain("is empty");
    expect(doc).not.toContain("<table>");
  });

  it("renders a header-only file as a table with no body rows", () => {
    const doc = tableHtmlDoc("a,b", "x.csv", ",");
    expect(doc).toContain("<th>a</th>");
    expect(doc).toContain("<tbody></tbody>");
  });

  // A wide table has to scroll inside its own box; the page must not scroll sideways.
  it("wraps the table in its own scroll container", () => {
    expect(tableHtmlDoc("a\n1", "x.csv", ",")).toContain('<div class="wrap">');
  });
});

// #2263. The app's theme as the document's own rules, appended after the system-theme ones.
describe("themeStyle", () => {
  const dark = { bg: "#1a1a2e", fg: "#e6e6f0", muted: "#a0a0b8", subtle: "#232342", border: "#33335a", link: "#4a8cff" };

  it("paints the body, code, links, quotes and tables in the theme's colours", () => {
    const css = themeStyle(dark);
    expect(css).toContain("body{color:#e6e6f0;background:#1a1a2e}");
    expect(css).toContain("pre{background:#232342}");
    expect(css).toContain("a{color:#4a8cff}");
    expect(css).toContain("th,td{border-color:#33335a}");
  });

  it("sets the colour scheme from the background, so controls match it", () => {
    expect(themeStyle(dark)).toContain(":root{color-scheme:dark}");
    expect(themeStyle({ ...dark, bg: "#f4f6fb" })).toContain(":root{color-scheme:light}");
  });

  it("comes after the system-theme rules in the document, so it wins", () => {
    const doc = htmlDoc("<p>x</p>", "a.md", themeStyle(dark));
    expect(doc.indexOf("background:#1a1a2e")).toBeGreaterThan(doc.indexOf("prefers-color-scheme"));
  });
});
