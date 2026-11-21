// The files an instruction file names (#3332): a CLAUDE.md or a SKILL.md points at docs and code by path,
// and a path that has moved or gone is an instruction nobody can follow. Pure: the text in, the paths it
// names out, each with where it may be (relative paths are taken against both the file's own folder and
// the working directory, since instructions are written either way).
import path from "node:path";
import { Lexer } from "marked";
import { pathReferences, resolveReference } from "./memory-health.js";

export interface NamedPath {
  /** As written. */
  reference: string;
  /** Where it may be: any one existing makes it found. */
  candidates: string[];
}

interface LinkToken {
  type: string;
  href?: string;
  tokens?: unknown[];
  items?: unknown[];
}

const isToken = (value: unknown): value is LinkToken => typeof value === "object" && value !== null && "type" in value && typeof value.type === "string";

/** Relative targets of Markdown links, outside code — read by marked's own lexer, as the renderer reads
 *  them: `[guide](docs/guide.md)`. Not a web address, a mail link, or an anchor on the same page; a
 *  `#section` after a path is dropped. */
export function linkTargets(text: string): string[] {
  const hrefs: string[] = [];
  const walk = (tokens: readonly unknown[]): void =>
    tokens.filter(isToken).forEach((token) => {
      if (token.type === "code" || token.type === "codespan") return;
      if (token.type === "link" && typeof token.href === "string") hrefs.push(token.href);
      walk([...(token.tokens ?? []), ...(token.items ?? [])]);
    });
  walk(new Lexer().lex(text));
  return hrefs.map((href) => href.split("#")[0] ?? "").filter((target) => target !== "" && !/^[a-z][a-z0-9+.-]*:/i.test(target));
}

/** A path written as an example or a convention rather than as this project's file: a placeholder name
 *  (`plans/fix-xxx.md`, `images/foo.png`), or a dot-folder's (`.cursor/mcp.json`, `.mulmoterminal/…`) —
 *  a tool's own config, named generically. Measured on real CLAUDE.md files, these were all the noise. */
const PLACEHOLDER_NAME = /^(?:x{3,}|foo|bar|example)(?:[.-]|$)/i;
const PLACEHOLDER_SUFFIX = /-x{3,}(?:\.|$)/i;

function isExample(reference: string): boolean {
  const parts = reference.split(/[\\/]/).filter((part) => part !== "" && part !== "." && part !== "..");
  if ((parts[0] ?? "").startsWith(".")) return true;
  return parts.some((part) => PLACEHOLDER_NAME.test(part) || PLACEHOLDER_SUFFIX.test(part));
}

/** The paths an instruction file names, each with the places it may be. */
export function namedPaths(text: string, file: string, cwd: string, home: string, windows: boolean): NamedPath[] {
  const folder = path.dirname(file);
  const references = [...new Set([...linkTargets(text), ...pathReferences(text)])].filter((reference) => !isExample(reference));
  return references.flatMap((reference) => {
    const places = [resolveReference(reference, folder, home, windows), resolveReference(reference, cwd, home, windows)];
    const candidates = [...new Set(places.filter((place): place is string => place !== null))];
    return candidates.length === 0 ? [] : [{ reference, candidates }];
  });
}
