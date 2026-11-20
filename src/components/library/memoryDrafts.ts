// Unsaved memory edits kept while their editor is gone (#3331): closing the Library or switching to
// Conversations unmounts the editor, and a draft must not be lost without a word. Kept per memory and
// for the version it was begun on — a draft over text that has changed since is not offered back.
export interface MemoryDraft {
  version: string;
  text: string;
}

const drafts = new Map<string, MemoryDraft>();

export const memoryDraftKey = (slug: string, file: string): string => `${slug}/${file}`;

export function keepMemoryDraft(key: string, draft: MemoryDraft): void {
  drafts.set(key, draft);
}
export function dropMemoryDraft(key: string): void {
  drafts.delete(key);
}

/** The draft kept for this memory, if it was begun on this version. */
export const memoryDraftFor = (key: string, version: string | undefined): MemoryDraft | null => {
  const kept = drafts.get(key);
  return kept !== undefined && kept.version === version ? kept : null;
};

/** A draft kept for this memory on another version: the file changed since it was begun, so it is not
 *  put back by itself — it is offered, and using it is the person's choice to write it over what is
 *  there now. Never lost either way. */
export const staleMemoryDraftFor = (key: string, version: string | undefined): MemoryDraft | null => {
  const kept = drafts.get(key);
  return kept !== undefined && kept.version !== version ? kept : null;
};

/** Whether any draft is kept for this memory, on whatever version. */
export const hasMemoryDraft = (key: string): boolean => drafts.has(key);
