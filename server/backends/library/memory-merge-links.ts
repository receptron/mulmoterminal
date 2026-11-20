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

/** The folder's other memories with their links to `names` pointed at `to`, those with none left out;
 *  and the ones holding such links that cannot be rewritten exactly — code the rules cannot place, or a
 *  text that is not the file's own bytes. A memory too large or unreadable is not looked into. */
export async function linkRewrites(folder: string, names: ReadonlySet<string>, to: string, skip: ReadonlySet<string>) {
  const files = (await memoryFileNames(folder)).filter((file) => !skip.has(file));
  const read = await inBatches(files, MEMORY_FILES_AT_ONCE, async (file) => ({ file, text: (await readBoundedText(path.join(folder, file))).text }));
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

/** What merging `fromFile` into `intoFile` as it is now would rewrite, said before it does: how many
 *  links, or which memories' links could not be rewritten exactly. Null when `into` cannot be read. */
export async function linksTo(fromFile: string, intoFile: string): Promise<{ count: number; unplaceable: string[] } | null> {
  const into = (await readBoundedText(intoFile)).text;
  if (into === null || !isFaithfulText(into)) return null;
  const plan = await linkPlan(fromFile, intoFile, into);
  return "kind" in plan ? { count: 0, unplaceable: plan.files } : { count: plan.count, unplaceable: [] };
}

export type LinkPlan = { text: string; count: number; rewrites: LinkRewrite[] } | { kind: "links-unplaceable"; files: string[] };

/** `from` and `into` are paths in one folder; `text` is what `into` is to be written with. */
export async function linkPlan(fromFile: string, intoFile: string, text: string): Promise<LinkPlan> {
  const from = (await readBoundedText(fromFile)).text;
  // Not a text it could write back: the delete refuses it, so nothing is rewritten for it either.
  if (from === null || !isFaithfulText(from)) return { text, count: 0, rewrites: [] };
  const [fromName, intoName] = [path.basename(fromFile), path.basename(intoFile)];
  const to = linkNameOf(intoName, text);
  // A name the two share already reaches `into`: rewriting it would change nothing.
  const names = new Set([...namesOf(fromName, from)].filter((name) => name !== to));
  const own = rewriteLinks(text, names, to);
  const ownLinked = linkNames(parseMemoryFrontmatter(text).body).some((name) => names.has(name));
  const { rewrites, unplaceable } = await linkRewrites(path.dirname(fromFile), names, to, new Set([fromName, intoName]));
  const files = [...(own === null && ownLinked ? [intoName] : []), ...unplaceable];
  if (files.length > 0) return { kind: "links-unplaceable", files };
  const count = (own?.count ?? 0) + rewrites.reduce((sum, rewrite) => sum + rewrite.count, 0);
  return { text: own?.text ?? text, count, rewrites };
}
