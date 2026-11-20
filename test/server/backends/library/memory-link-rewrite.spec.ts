// @vitest-environment node
// Where code is in a memory, and rewriting the `[[links]]` outside it when one is merged (#3331).
import { describe, it, expect } from "vitest";
import { codeRanges, linkNameOf, namesOf, rewriteLinks } from "../../../../server/backends/library/memory-link-rewrite";
import { isToken, linkNames, splitCode } from "../../../../server/backends/library/memory-health";
import { seededRandom } from "../../../helpers/seededRandom";
import { Lexer } from "marked";

/** The code the lexer itself finds, as it hands it back: what a rewrite must leave alone. */
const lexedCode = (tokens: readonly unknown[]): string[] =>
  tokens
    .filter(isToken)
    .flatMap((token) => (token.type === "code" || token.type === "codespan" ? [token.raw] : lexedCode([...(token.tokens ?? []), ...(token.items ?? [])])));

const A = new Set(["a", "alpha"]);

describe("codeRanges", () => {
  it("places inline code and fenced blocks in the text", () => {
    const text = "See `x [[a]]` and\n\n```\n[[a]]\n```\n";
    const ranges = codeRanges(text) ?? [];
    expect(ranges.map((range) => text.slice(range.start, range.end))).toEqual(["`x [[a]]`", "```\n[[a]]\n```\n"]);
  });

  it("places a fenced block inside a list item, whose indent the lexer takes off", () => {
    const text = "- item\n\n  ```\n  [[a]]\n  ```\n- next `[[a]]`\n";
    const ranges = codeRanges(text) ?? [];
    expect(ranges).toHaveLength(2);
    ranges.forEach((range) => expect(text.slice(range.start, range.end)).toContain("[[a]]"));
  });

  it("is empty for text with no code, and for no text", () => {
    expect(codeRanges("plain [[a]] text")).toEqual([]);
    expect(codeRanges("")).toEqual([]);
  });

  it("gives up on code it cannot find again in the text, rather than guess", () => {
    expect(codeRanges("a\r\n`[[a]]`\r\n")).toBeNull();
  });

  it("finds a last line the lexer trims", () => {
    const text = "- item\n`[[a]]` text ";
    expect((codeRanges(text) ?? []).map((range) => text.slice(range.start, range.end))).toEqual(["`[[a]]`"]);
  });
});

describe("rewriteLinks", () => {
  it("points the links naming the memory at the other one, and counts them", () => {
    expect(rewriteLinks("[[a]] and [[ alpha ]] but not [[b]]", A, "beta")).toEqual({ text: "[[beta]] and [[beta]] but not [[b]]", count: 2 });
  });

  it("leaves links inside code as they are", () => {
    const text = "[[a]] `[[a]]`\n\n```\n[[alpha]]\n```\n\n- x\n\n  ```\n  [[a]]\n  ```\n";
    const rewritten = rewriteLinks(text, A, "beta");
    expect(rewritten?.count).toBe(1);
    expect(rewritten?.text).toBe(text.replace("[[a]] `", "[[beta]] `"));
  });

  it("finds code in a text written with \\r\\n throughout, and keeps its line ends", () => {
    expect(rewriteLinks("[[a]]\r\n`[[a]]`\r\n\r\n```\r\n[[a]]\r\n```\r\n", A, "beta")).toEqual({
      text: "[[beta]]\r\n`[[a]]`\r\n\r\n```\r\n[[a]]\r\n```\r\n",
      count: 1,
    });
  });

  it("rewrites nothing when where the code is cannot be told, but text with no code needs no telling", () => {
    expect(rewriteLinks("[[a]]\r\n`[[a]]`\n", A, "beta")).toBeNull();
    expect(rewriteLinks("[[a]]\r\nmore\n", A, "beta")).toEqual({ text: "[[beta]]\r\nmore\n", count: 1 });
  });

  it("leaves the frontmatter byte for byte: a link is the body's, as the health check reads it", () => {
    const fm = '---\nname: alpha\ndescription: "see [[alpha]]"\n---\n';
    expect(rewriteLinks(`${fm}Body [[a]].\n`, A, "beta")).toEqual({ text: `${fm}Body [[beta]].\n`, count: 1 });
    expect(rewriteLinks(`${fm}No link.\n`, A, "beta")).toEqual({ text: `${fm}No link.\n`, count: 0 });
    const crlf = "---\r\ndescription: [[alpha]]\r\n---\r\n[[alpha]]\r\n";
    expect(rewriteLinks(crlf, A, "beta")).toEqual({ text: "---\r\ndescription: [[alpha]]\r\n---\r\n[[beta]]\r\n", count: 1 });
    expect(rewriteLinks(`\uFEFF${fm}[[a]]`, A, "beta")).toEqual({ text: `\uFEFF${fm}[[beta]]`, count: 1 });
    // Mixed line ends with no code: every line end is kept, the frontmatter's included.
    const mixed = "---\r\ndescription: [[alpha]]\r\n---\r\nSee [[alpha]].\nMore [[a]].\r\n";
    expect(rewriteLinks(mixed, A, "beta")).toEqual({ text: "---\r\ndescription: [[alpha]]\r\n---\r\nSee [[beta]].\nMore [[beta]].\r\n", count: 2 });
  });

  it("rewrites a memory with frontmatter as it rewrites its body alone (seed 3333)", () => {
    const random = seededRandom(3333);
    const BODY = ["[[a]]", "[[alpha]]", "`[[a]]`", "\n\n```\n[[a]]\n```\n\n", "text ", "\n", "\n---\n"];
    const HEADS = ["", "---\nname: alpha\n---\n", "---\ndescription: [[alpha]] and `x`\n---\n", "---\nname: x\nmetadata:\n  type: note [[a]]\n---\n"];
    Array.from({ length: 1000 }).forEach(() => {
      const head = random.pick(HEADS);
      const body = Array.from({ length: random.below(8) }, () => random.pick(BODY)).join("");
      const alone = rewriteLinks(body, A, "beta");
      const whole = rewriteLinks(`${head}${body}`, A, "beta");
      // Only where the head parses as frontmatter is it set apart; a body opening with `---` is still the body.
      if (head !== "" && !body.startsWith("\n---")) expect(whole).toEqual(alone === null ? null : { ...alone, text: `${head}${alone.text}` });
    });
  });

  it("leaves no named link outside code, and code as it was, over generated memories (seed 3331)", () => {
    const random = seededRandom(3331);
    const PIECES = [
      "[[a]]",
      "[[alpha]]",
      "[[b]]",
      "`[[a]]`",
      "``x [[a]] ``",
      "\n\n```\n[[a]]\n```\n\n",
      "\n- item [[a]]\n",
      "\n\n    [[a]] indented\n\n",
      "text ",
      "\n",
      "*em* ",
      "# h [[a]]\n",
    ];
    Array.from({ length: 1500 }).forEach(() => {
      const text = Array.from({ length: random.below(10) }, () => random.pick(PIECES)).join("");
      const rewritten = rewriteLinks(text, A, "beta");
      expect(rewritten).not.toBeNull();
      if (rewritten === null) return;
      expect(linkNames(rewritten.text).filter((name) => A.has(name))).toEqual([]);
      expect(splitCode(rewritten.text).spans).toEqual(splitCode(text).spans);
      const blocks = (source: string): string[] => lexedCode(new Lexer().lex(source));
      expect(blocks(rewritten.text)).toEqual(blocks(text));
      expect(rewritten.count).toBe(linkNames(text).filter((name) => A.has(name)).length);
    });
  });

  it("rewrites a \\r\\n text as it rewrites the same text with \\n, line ends kept (seed 3332)", () => {
    const random = seededRandom(3332);
    const PIECES = ["[[a]]", "[[b]]", "`[[a]]`", "\n\n```\n[[a]]\n```\n\n", "\n- item [[a]]\n  ```\n  [[a]]\n  ```\n", "text ", "\n"];
    Array.from({ length: 1000 }).forEach(() => {
      const text = Array.from({ length: random.below(10) }, () => random.pick(PIECES)).join("");
      const lf = rewriteLinks(text, A, "beta");
      const crlf = rewriteLinks(text.replace(/\n/g, "\r\n"), A, "beta");
      expect(crlf).toEqual(lf === null ? null : { ...lf, text: lf.text.replace(/\n/g, "\r\n") });
    });
  });
});

describe("namesOf / linkNameOf", () => {
  it("reaches a memory by its file name and its frontmatter name", () => {
    expect([...namesOf("a.md", "---\nname: alpha\n---\nbody")]).toEqual(["a", "alpha"]);
    expect([...namesOf("a.md", "no frontmatter")]).toEqual(["a"]);
    expect([...namesOf("a.md", "---\nname: \n---\n")]).toEqual(["a"]);
  });

  it("writes a link with the frontmatter name, else the file name", () => {
    expect(linkNameOf("b.md", "---\nname: beta\n---\n")).toBe("beta");
    expect(linkNameOf("b.md", "plain")).toBe("b");
    expect(linkNameOf("b.md", "---\nname: a ]] b\n---\n")).toBe("b");
  });
});
