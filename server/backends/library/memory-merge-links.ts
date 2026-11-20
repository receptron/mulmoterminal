// The `[[links]]` a merge points elsewhere (#3331): in which of a folder's memories they are, and those
// memories' texts with them rewritten. Reads the folder; writes nothing.
import path from "node:path";
import { parseMemoryFrontmatter } from "../../../common/libraryMemory.js";
import { readBoundedText } from "./file-history-read.js";
import { inBatches, MEMORY_FILES_AT_ONCE, memoryFileNames } from "./memory-folders.js";
import { linkNames } from "./memory-health.js";
import { linkNameOf, namesOf, rewriteLinks } from "./memory-link-rewrite.js";
import { isFaithfulText } from "./memory-write.js";

/** One memory with its links rewritten: the text it had, and the one it gets. */
export interface LinkRewrite {
  file: string;
  before: string;
  text: string;
  count: number;
}

/** A memory as read: null when it could not be (too large, gone, unreadable). */
interface MemoryText {
  file: string;
  text: string | null;
}

const readTexts = (folder: string, files: readonly string[]): Promise<MemoryText[]> =>
  inBatches(files, MEMORY_FILES_AT_ONCE, async (file) => ({ file, text: (await readBoundedText(path.join(folder, file))).text }));

/** These memories with their links to `names` pointed at `to`, those with none left out; and the ones
 *  holding such links that cannot be rewritten exactly — code the rules cannot place, or a text that is
 *  not the file's own bytes. A memory that could not be read is not looked into. */
function linkRewrites(read: readonly MemoryText[], names: ReadonlySet<string>, to: string) {
  const rewrites: LinkRewrite[] = [];
  const unplaceable: string[] = [];
  read.forEach(({ file, text }) => {
    if (text === null) return;
    const rewritten = isFaithfulText(text) ? rewriteLinks(text, names, to) : null;
    if (rewritten === null) {
      if (linkNames(parseMemoryFrontmatter(text).body).some((name) => names.has(name))) unplaceable.push(file);
    } else if (rewritten.count > 0) rewrites.push({ file, before: text, ...rewritten });
  });
  return { rewrites, unplaceable };
}

/** The names a link reaches `from` by and no other memory of the folder: a name another memory has too
 *  (the one kept included) is not `from`'s alone, and a link by it is left to mean what it means. */
function namesOnlyOf(fromName: string, from: string, others: readonly MemoryText[]): Set<string> {
  const taken = new Set(others.flatMap(({ file, text }) => [...namesOf(file, text ?? "")]));
  return new Set([...namesOf(fromName, from)].filter((name) => !taken.has(name)));
}

/** What merging `fromFile` into `intoFile` as it is now would rewrite, said before it does: how many
 *  links, or which memories' links could not be rewritten exactly. Null when `into` cannot be read. */
export async function linksTo(fromFile: string, intoFile: string): Promise<{ count: number; unplaceable: string[] } | null> {
  const into = (await readBoundedText(intoFile)).text;
  if (into === null || !isFaithfulText(into)) return null;
  const plan = await linkPlan(fromFile, intoFile, into, await memoryFileNames(path.dirname(fromFile)));
  return "kind" in plan ? { count: 0, unplaceable: plan.files } : { count: plan.count, unplaceable: [] };
}

export type LinkPlan = { text: string; count: number; rewrites: LinkRewrite[] } | { kind: "links-unplaceable"; files: string[] };

/** `from` and `into` are paths in one folder; `text` is what `into` is to be written with; `others`, the
 *  other memories of the folder it may rewrite — for a merge, the ones whose turns it holds. */
export async function linkPlan(fromFile: string, intoFile: string, text: string, others: readonly string[]): Promise<LinkPlan> {
  const from = (await readBoundedText(fromFile)).text;
  // Not a text it could write back: the delete refuses it, so nothing is rewritten for it either.
  if (from === null || !isFaithfulText(from)) return { text, count: 0, rewrites: [] };
  const [fromName, intoName] = [path.basename(fromFile), path.basename(intoFile)];
  const to = linkNameOf(intoName, text);
  const read = await readTexts(
    path.dirname(fromFile),
    others.filter((file) => file !== fromName && file !== intoName),
  );
  const names = namesOnlyOf(fromName, from, [{ file: intoName, text }, ...read]);
  const own = rewriteLinks(text, names, to);
  const ownLinked = linkNames(parseMemoryFrontmatter(text).body).some((name) => names.has(name));
  const { rewrites, unplaceable } = linkRewrites(read, names, to);
  const files = [...(own === null && ownLinked ? [intoName] : []), ...unplaceable];
  if (files.length > 0) return { kind: "links-unplaceable", files };
  const count = (own?.count ?? 0) + rewrites.reduce((sum, rewrite) => sum + rewrite.count, 0);
  return { text: own?.text ?? text, count, rewrites };
}
