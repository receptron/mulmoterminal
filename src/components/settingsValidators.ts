// The "may I add this?" rules for the settings lists: a PR repo, a cell launcher, an HTTP MCP
// server. Each is a format check AND a uniqueness check, and each drives BOTH a button's
// disabled state and the add handler's guard. They were written twice per rule (the computed
// and the guard), which is how a validated-but-rejected input — an enabled button that does
// nothing — or the reverse slips in. One definition each, consumed by both.

// `owner/repo`, each side the GitHub-safe character set. A malformed value silently breaks the
// cross-repo PR view's fetch.
const REPO_RE = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;

export function canAddRepo(repo: string, existing: readonly string[]): boolean {
  const trimmed = repo.trim();
  return REPO_RE.test(trimmed) && !existing.includes(trimmed);
}

export function canAddLauncher(label: string, command: string, existing: readonly { label: string }[]): boolean {
  const l = label.trim();
  const c = command.trim();
  return !!l && !!c && !existing.some((entry) => entry.label === l);
}

// The id becomes the `mcp__<id>` tool prefix server-side, so it is restricted; the url must be
// http(s). A bad id breaks the tool namespace; a non-http url breaks the MCP connection.
const MCP_ID_RE = /^[A-Za-z0-9_-]+$/;
const MCP_URL_RE = /^https?:\/\/\S+$/;

export function canAddMcpServer(id: string, url: string, existing: readonly { id: string }[]): boolean {
  const i = id.trim();
  const u = url.trim();
  return MCP_ID_RE.test(i) && MCP_URL_RE.test(u) && !existing.some((entry) => entry.id === i);
}
