// The default environment here is jsdom, which is what this spec needs.
// The tab document parsed as a browser parses it (#3238): raw HTML in the file can close the
// rendering's wrapper and plant elements beside it that repeat the shell's ids and classes, or leave
// a raw-text element open and turn everything after it into text. The script's contract is
// positional — the first four children of <body> are the shell's, the script among them — and this
// is where that contract meets a parser.
import { describe, it, expect } from "vitest";
import { renderedTabDoc, tabToolLabelsFor } from "../../server/files/renderedTabTools";

const HOSTILE_RENDERING = [
  "<h1>title</h1>",
  // marked passes raw HTML through: this closes our wrapper and plants look-alikes as body children
  '</div><pre id="tab-source"><code>attacker source</code></pre>',
  '<div class="tab-tools"><span class="tab-tools-status" data-copied="pwned"></span><button data-copy="source">x</button></div>',
  "<p>rest of the file</p>",
].join("\n");

const parse = (html: string): Document => new DOMParser().parseFromString(html, "text/html");
const labels = tabToolLabelsFor("en", "markdown");

describe("the tab document under hostile Markdown", () => {
  const doc = parse(renderedTabDoc({ html: HOSTILE_RENDERING, source: "the real source\n", title: "a.md", style: "", nonce: "n", labels }));
  const [toolbar, source, script, rendered] = doc.body.children;

  it("keeps the shell's four elements first, whatever the file plants beside them", () => {
    expect(toolbar?.className).toBe("tab-tools");
    expect(source?.id).toBe("tab-source");
    expect(source?.textContent).toBe("the real source\n");
    expect(script?.tagName).toBe("SCRIPT");
    expect(script?.getAttribute("nonce")).toBe("n");
    expect(rendered?.id).toBe("tab-rendered");
  });

  it("leaves the file's look-alikes after the wrapper, where the script treats them as rendering", () => {
    const after = Array.from(doc.body.children).slice(4);
    expect(after.some((el) => el.id === "tab-source" && el.textContent === "attacker source")).toBe(true);
    expect(after.some((el) => el.className === "tab-tools")).toBe(true);
    expect(after.some((el) => el.tagName === "SCRIPT")).toBe(false);
  });

  // An unclosed raw-text element turns everything after itself into text. The script sits before
  // the rendering, so it is still a script; the rendering swallows itself and nothing else.
  it.each(["<textarea>oops", "<style>body{}", "<title>t", "<xmp>x", "<script>void 0"])("stays a script when the file leaves %s unclosed", (rawText) => {
    const swallowed = parse(renderedTabDoc({ html: `<p>before</p>\n${rawText}\n<p>after</p>`, source: "s", title: "a.md", style: "", nonce: "n2", labels }));
    const kids = Array.from(swallowed.body.children);
    expect(kids[2]?.tagName).toBe("SCRIPT");
    expect(kids[2]?.getAttribute("nonce")).toBe("n2");
    expect(kids[3]?.id).toBe("tab-rendered");
    expect(swallowed.querySelectorAll("script[nonce]")).toHaveLength(1);
  });

  it("carries the source through the parser untouched in its data block, while the <pre> is rewritten", () => {
    const exact = "line\r\nnul\u0000end</script>\r\n";
    const parsed = parse(renderedTabDoc({ html: "<p>x</p>", source: exact, title: "crlf.md", style: "", nonce: "n", labels }));
    const [bar, pre] = parsed.body.children;
    expect(JSON.parse(bar?.querySelector("script[data-tab-source]")?.textContent ?? '""')).toBe(exact);
    expect(pre?.textContent).not.toBe(exact);
    expect(pre?.textContent).toContain("line\nnul");
  });

  it("gives the toolbar only its own buttons and status", () => {
    expect(toolbar?.querySelectorAll("[data-copy]")).toHaveLength(2);
    expect(toolbar?.querySelector(".tab-tools-status")?.getAttribute("data-copied")).toBe("Copied");
  });
});
