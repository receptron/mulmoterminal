// Which memory can be tidied (#3331), decided by rule alone — nothing here reads a disk. The reader
// (memory-health-read.ts) hands in the texts and which named paths exist.
import path from "node:path";
import {
  MEMORY_INDEX_BYTES_MAX,
  MEMORY_INDEX_LINES_MAX,
  parseMemoryFrontmatter,
  type LibraryMemoryHealth,
  type MemoryFileIssue,
  type MemoryProjectIssue,
} from "../../../common/libraryMemory.js";

/** One project's memory as the rules see it. A file whose text could not be read has `text: null` and
 *  is judged only on what needs no text. */
export interface MemoryHealthInput {
  slug: string;
  index: { text: string | null; lines: number; bytes: number } | null;
  files: { file: string; text: string | null }[];
}

/** The frontmatter fields a memory is written with; a file missing one cannot be found or recalled by it. */
const REQUIRED_FIELDS = ["name", "description", "type"] as const;

/** Text with code taken out: a `[[name]]` or a path inside a code span or block is an example, not a
 *  reference (the renderer leaves those inert too). */
const withoutCode = (body: string): string => body.replace(/```[\s\S]*?(```|$)/g, " ").replace(/`[^`\n]*`/g, " ");

/** The memory files `MEMORY.md` points at: the targets of its Markdown links that name a file here. */
export function indexEntries(indexText: string): string[] {
  return [...indexText.matchAll(/\]\(([^)\s]+\.md)\)/g)].map((match) => match[1] ?? "").filter((target) => !target.includes("/"));
}

/** The `[[name]]` links in a body, outside code. */
export const linkNames = (body: string): string[] => [...withoutCode(body).matchAll(/\[\[([^\]\n]{1,200})\]\]/g)].map((match) => (match[1] ?? "").trim());

/** Paths a body names in code spans — `server/foo.ts`, `~/.codex/config.toml` — the way memory points at
 *  files: a slash and an extension, no scheme, no wildcard or placeholder. It cannot start with `@`, so
 *  a package (`@scope/name@1.2.3`, a slash and a dot too) is not one. */
export function pathReferences(body: string): string[] {
  const spans = [...body.replace(/```[\s\S]*?(```|$)/g, " ").matchAll(/`([^`\n]{3,300})`/g)].map((match) => (match[1] ?? "").trim());
  const looksLikePath = (span: string): boolean =>
    /^(?:[A-Za-z]:)?[~./\\\w-][\w.@~/\\-]*\.[A-Za-z0-9]{1,8}$/.test(span) && /[/\\]/.test(span) && !span.includes("//");
  return [...new Set(spans.filter(looksLikePath))];
}

/** Where a named path is on disk: `~/` under the home, absolute as it is, relative under the project's
 *  directory — or null when it is relative and the directory is not known, or when it is written the
 *  Windows way (a drive or backslashes) on another system, where it would read as a relative name. */
export function resolveReference(reference: string, cwd: string | null, home: string, windows: boolean): string | null {
  if (!windows && /(?:^[A-Za-z]:)|\\/.test(reference)) return null;
  if (reference.startsWith("~/") || (windows && reference.startsWith("~\\"))) return path.join(home, reference.slice(2));
  if (path.isAbsolute(reference)) return reference;
  return cwd === null ? null : path.resolve(cwd, reference);
}

/** `listed` is null when there is no index to be in, or it could not be read: then nothing is said
 *  about being in it. */
function fileIssues(
  file: { file: string; text: string | null },
  listed: ReadonlySet<string> | null,
  names: ReadonlySet<string>,
  missingPaths: ReadonlySet<string>,
): MemoryFileIssue[] {
  const issues: MemoryFileIssue[] = [];
  if (listed !== null && !listed.has(file.file)) issues.push({ kind: "not-in-index" });
  if (file.text === null) return issues;
  const { fields, metadata, body } = parseMemoryFrontmatter(file.text);
  const present: Record<string, string | undefined> = { ...fields, type: metadata.type?.trim() || fields.type };
  const missing = REQUIRED_FIELDS.filter((field) => (present[field] ?? "").trim() === "");
  if (missing.length > 0) issues.push({ kind: "no-frontmatter", missing });
  const broken = [...new Set(linkNames(body))].filter((name) => !names.has(name));
  if (broken.length > 0) issues.push({ kind: "broken-link", names: broken });
  const gone = pathReferences(body).filter((reference) => missingPaths.has(reference));
  if (gone.length > 0) issues.push({ kind: "missing-path", paths: gone });
  return issues;
}

/** The project's issues and each file's. `missingPaths` are the named paths found not to exist. */
export function memoryHealth(input: MemoryHealthInput, missingPaths: ReadonlySet<string>): LibraryMemoryHealth {
  const fileNames = new Set(input.files.map((file) => file.file));
  const listed = input.index?.text == null ? null : new Set(indexEntries(input.index.text));
  const names = new Set(
    input.files
      .flatMap((file) => [file.file.replace(/\.md$/, ""), ...(file.text === null ? [] : [parseMemoryFrontmatter(file.text).fields.name ?? ""])])
      .filter((name) => name !== ""),
  );
  const issues: MemoryProjectIssue[] = [];
  if (input.index === null && input.files.length > 0) issues.push({ kind: "no-index" });
  if (input.index !== null && (input.index.lines > MEMORY_INDEX_LINES_MAX || input.index.bytes > MEMORY_INDEX_BYTES_MAX))
    issues.push({ kind: "index-over-limit" });
  const dead = [...(listed ?? [])].filter((file) => !fileNames.has(file));
  if (dead.length > 0) issues.push({ kind: "dead-index-entry", files: dead });
  const files = Object.fromEntries(
    input.files.map((file) => [file.file, fileIssues(file, listed, names, missingPaths)] as const).filter(([, found]) => found.length > 0),
  );
  return { slug: input.slug, issues, files };
}

/** The top folder of an absolute path — `/Users` of `/Users/me/x.md`, `C:\\work` of `C:\\work\\x.md` —
 *  with the path flavour handed in, so both are decided the same on any system. */
export function topFolder(resolved: string, flavour: Pick<typeof path, "parse" | "sep" | "join">): string | null {
  const { root } = flavour.parse(resolved);
  const top = resolved
    .slice(root.length)
    .split(flavour.sep)
    .filter((part) => part !== "")[0];
  return top === undefined ? null : flavour.join(root, top);
}
