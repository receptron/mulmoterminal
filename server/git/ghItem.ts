// The fields every `gh` list row shares (issues and PRs alike): identity (number, url),
// display text (title, author, updatedAt). issues.ts / prs.ts layer their own extra
// fields on top of this base.
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const asString = (v: unknown): string => (typeof v === "string" ? v : "");

export interface GhItemBase {
  number: number;
  title: string;
  author: string;
  updatedAt: string;
  url: string;
}

// Returns null when the row lacks the identity fields (number + url) — a row we can't
// link to or key on is not worth rendering. Missing text fields degrade to "".
export function normalizeGhItemBase(raw: unknown): GhItemBase | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.number !== "number" || typeof raw.url !== "string") return null;
  const author = isRecord(raw.author) && typeof raw.author.login === "string" ? raw.author.login : "";
  return { number: raw.number, title: asString(raw.title), author, updatedAt: asString(raw.updatedAt), url: raw.url };
}

export { isRecord };
