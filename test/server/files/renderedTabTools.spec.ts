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
  // The order is the script's contract: the file's rendering comes last, so nothing the file
  // contains can precede the three elements the script reads by position.
  it("puts the toolbar first, then the source hidden, then the rendering, then the script", () => {
    const html = doc();
    const order = [
      'class="tab-tools"',
      '<pre id="tab-source" hidden><code># hi\n</code></pre>',
      '<div id="tab-rendered"><h1>hi</h1></div>',
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

  // What the one script must be made of, read off its text. Raw HTML in the file can close the
  // rendering's wrapper and repeat any id or class beside it, so the script reads its three elements
  // by POSITION — the first children of <body>, which the file cannot precede — checks the shell's
  // marks on them, finds itself as currentScript, and looks for buttons inside the toolbar only. What
  // follows a wrapper the file closed early is still the rendering (the elements from the wrapper up
  // to the script). And the SOURCE's fallback copy selects a textarea holding the exact text, since
  // selecting an element's contents ends at its last character and loses the file's final newline;
  // the rendering keeps the selection, which is what carries its formatting.
  it.each([
    [
      "reads its elements by position",
      [
        "const [toolbar, source, rendered] = document.body.children;",
        "const script = document.currentScript;",
        'source.id !== "tab-source" || rendered.id !== "tab-rendered"',
      ],
    ],
    ["looks for buttons inside the toolbar only", ['toolbar.querySelectorAll("[data-show]")', 'toolbar.querySelectorAll("[data-copy]")']],
    [
      "treats everything between the wrapper and the script as the rendering",
      ["for (let el = rendered; el && el !== script; el = el.nextElementSibling)", "range.setStartBefore(rendered);", "range.setEndBefore(script);"],
    ],
    ["copies the rendering as text and as HTML, and falls back to a selection", ['"text/plain"', '"text/html"', 'execCommand("copy")']],
    ["falls back to a textarea for the source", ['document.createElement("textarea")', "area.value = source.textContent", "area.select()"]],
  ])("%s", (_what, parts) => {
    const script = scriptOf(doc());
    parts.forEach((part) => expect(script).toContain(part));
  });

  it.each(["getElementById", "document.querySelector(", "document.querySelectorAll("])("never looks an element up with %s", (lookup) => {
    expect(scriptOf(doc())).not.toContain(lookup);
  });

  it("keeps the route's style and adds the toolbar's", () => {
    const html = doc({ style: "body{max-width:none}" });
    expect(html).toContain("body{max-width:none}.tab-tools{");
  });
});
