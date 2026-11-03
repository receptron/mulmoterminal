// @vitest-environment node
// The toolbar a rendered document carries in a tab of its own (#3238): the switch to the source,
// the two copy buttons, and the one script that is admitted by nonce while the file's are not.
import { describe, it, expect } from "vitest";
import { renderedTabDoc, tabToolLabelsFor, TAB_TOOL_LANGUAGES, type TabToolLabels } from "../../../server/files/renderedTabTools";

const labels = (over: Partial<TabToolLabels> = {}): TabToolLabels => ({ ...tabToolLabelsFor("en", "markdown"), ...over });

const doc = (over: Partial<Parameters<typeof renderedTabDoc>[0]> = {}): string =>
  renderedTabDoc({ html: "<h1>hi</h1>", source: "# hi\n", title: "a.md", style: "", nonce: "n0nce", labels: labels(), ...over });

const scriptOf = (html: string): string => /<script nonce="[^"]*">([\s\S]*?)<\/script>/.exec(html)?.[1] ?? "";

describe("tabToolLabelsFor", () => {
  it("names the rendering by what the route rendered", () => {
    expect(tabToolLabelsFor("en", "markdown").rendered).toBe("Preview");
    expect(tabToolLabelsFor("en", "json").rendered).toBe("Formatted");
    expect(tabToolLabelsFor("en", "table").rendered).toBe("Table");
    expect(tabToolLabelsFor("en", "table").copyRendered).toBe("Copy table");
  });

  it("speaks the language the request negotiated, and English for one it did not", () => {
    expect(tabToolLabelsFor("ja", "markdown").source).toBe("ソース");
    expect(tabToolLabelsFor("zh-TW", "markdown").copied).not.toBe(tabToolLabelsFor("zh-CN", "markdown").copied);
    expect(tabToolLabelsFor(false, "markdown")).toEqual(tabToolLabelsFor("en", "markdown"));
    expect(tabToolLabelsFor("fr", "markdown")).toEqual(tabToolLabelsFor("en", "markdown"));
    expect(tabToolLabelsFor(undefined, "markdown")).toEqual(tabToolLabelsFor("en", "markdown"));
  });

  it("has every label in every language it offers", () => {
    TAB_TOOL_LANGUAGES.forEach((language) => {
      Object.values(tabToolLabelsFor(language, "json")).forEach((label) => expect(label).not.toBe(""));
    });
  });
});

describe("renderedTabDoc", () => {
  it("puts the toolbar first, then the rendering, then the source hidden, then the script", () => {
    const html = doc();
    const order = [
      'class="tab-tools"',
      '<div id="tab-rendered"><h1>hi</h1></div>',
      '<pre id="tab-source" hidden><code># hi\n</code></pre>',
      '<script nonce="n0nce">',
    ].map((part) => html.indexOf(part));
    expect(order.every((at) => at >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("offers both views and both copies, with the rendering shown", () => {
    const html = doc();
    expect(html).toContain('<button type="button" data-show="rendered" aria-pressed="true">Preview</button>');
    expect(html).toContain('<button type="button" data-show="source" aria-pressed="false">Source</button>');
    expect(html).toContain('<button type="button" data-copy="source">Copy source</button>');
    expect(html).toContain('<button type="button" data-copy="rendered">Copy preview</button>');
  });

  // The script reads what to say off the document, so a label is text in the document and never
  // part of the script — and like every value written into the shell, it is escaped.
  it("hands the notices to the script as attributes, escaped", () => {
    const html = doc({ labels: labels({ copied: 'done "ok" <b>', copyFailed: "no & no" }) });
    expect(html).toContain('data-copied="done &quot;ok&quot; &lt;b&gt;"');
    expect(html).toContain('data-failed="no &amp; no"');
    expect(scriptOf(html)).not.toContain("done");
  });

  it("shows the source as text, so nothing in it is markup", () => {
    const html = doc({ source: '<script>document.title = "ran"</script>\n<img src=x onerror="x()">' });
    expect(html).toContain("&lt;script&gt;document.title = &quot;ran&quot;&lt;/script&gt;");
    expect(html).toContain("&lt;img src=x onerror=&quot;x()&quot;&gt;");
    expect(html).not.toContain("<script>document.title");
    expect(html).not.toContain("<img");
  });

  // THE claim that lets the tab run a script at all: the one script is a constant, so a response
  // adds nothing to it but the nonce on its tag, and the file can name neither.
  it("writes one script, the same whatever the file, the labels or the nonce", () => {
    const a = doc();
    const b = doc({ source: "<script>x</script>", html: "<p>other</p>", nonce: "other", labels: tabToolLabelsFor("ja", "table") });
    expect(a.split("<script")).toHaveLength(2);
    expect(b.split("<script")).toHaveLength(2);
    expect(scriptOf(a)).toBe(scriptOf(b));
    expect(a).toContain('<script nonce="n0nce">');
    expect(b).toContain('<script nonce="other">');
  });

  // The file's own HTML lands inside the rendering, so an id it repeats is a descendant; the script
  // reaches its elements as children of <body> and never by a bare id.
  it("finds its elements structurally, not by an id the file could repeat", () => {
    const script = scriptOf(doc());
    expect(script).toContain('querySelector("body > #tab-rendered")');
    expect(script).toContain('querySelector("body > #tab-source")');
    expect(script).not.toContain("getElementById");
  });

  it("copies the rendering as text and as HTML, and falls back to selecting it", () => {
    const script = scriptOf(doc());
    expect(script).toContain('"text/plain"');
    expect(script).toContain('"text/html"');
    expect(script).toContain('execCommand("copy")');
  });

  it("keeps the route's style and adds the toolbar's", () => {
    const html = doc({ style: "body{max-width:none}" });
    expect(html).toContain("body{max-width:none}.tab-tools{");
  });
});
