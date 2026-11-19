// The text work search needs around the index (#3328). Pure.

/** `%`, `_` and the escape character itself, so a query is matched as typed. Used with `ESCAPE '\'`. */
export const escapeLike = (query: string): string => query.replace(/[\\%_]/g, (char) => `\\${char}`);

/** Characters of context on each side of a match. */
export const SNIPPET_CONTEXT_CHARS = 60;

/** The part of `text` around the first case-insensitive match of `query`, with `…` where it was cut.
 *  With no match (the row matched on its title), the start of the text, as long as a match would show. */
export function snippetAround(text: string, query: string, context = SNIPPET_CONTEXT_CHARS): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const found = query === "" ? -1 : flat.toLowerCase().indexOf(query.toLowerCase());
  const at = Math.max(found, 0);
  const matched = found < 0 ? 0 : query.length;
  const start = Math.max(at - context, 0);
  const end = Math.min(at + matched + context * (found < 0 ? 2 : 1), flat.length);
  return `${start > 0 ? "…" : ""}${flat.slice(start, end)}${end < flat.length ? "…" : ""}`;
}
