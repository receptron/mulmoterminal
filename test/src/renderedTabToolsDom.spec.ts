// The default environment here is jsdom, which is what this spec needs.
// The tab document parsed as a browser parses it (#3238): raw HTML in the file can close the
// rendering's wrapper and plant elements beside it that repeat the shell's ids and classes. The
// script's contract is positional — the first three children of <body> are the shell's — and this
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

describe("the tab document under hostile Markdown", () => {
  const doc = parse(
    renderedTabDoc({ html: HOSTILE_RENDERING, source: "the real source\n", title: "a.md", style: "", nonce: "n", labels: tabToolLabelsFor("en", "markdown") }),
  );
  const [toolbar, source, rendered] = doc.body.children;

  it("keeps the shell's three elements first, whatever the file plants beside them", () => {
    expect(toolbar?.className).toBe("tab-tools");
    expect(source?.id).toBe("tab-source");
    expect(source?.textContent).toBe("the real source\n");
    expect(rendered?.id).toBe("tab-rendered");
  });

  it("leaves the file's look-alikes after the wrapper, where the script treats them as rendering", () => {
    const after = Array.from(doc.body.children).slice(3);
    expect(after.some((el) => el.id === "tab-source" && el.textContent === "attacker source")).toBe(true);
    expect(after.some((el) => el.className === "tab-tools")).toBe(true);
    expect(after[after.length - 1]?.tagName).toBe("SCRIPT");
  });

  it("gives the toolbar only its own buttons and status", () => {
    expect(toolbar?.querySelectorAll("[data-copy]")).toHaveLength(2);
    expect(toolbar?.querySelector(".tab-tools-status")?.getAttribute("data-copied")).toBe("Copied");
  });
});
