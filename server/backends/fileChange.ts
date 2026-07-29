// Workspace file-change publisher, shared with MulmoClaude via @mulmoclaude/core.
// A write site calls publishFileChange(workspaceRelPath); the publisher stats the
// post-write mtime and forwards a { path, mtimeMs } payload to every plugin View
// whose scope matches, on the channel that View's runtime subscribes to
// (plugin:<scope>:file:<path>). This unifies the markdown + html live-refresh paths
// that each previously hand-rolled their own pubsub publish.
//
// No primaryChannel: MulmoTerminal has no general files-explorer subscriber, so only
// the plugin-scoped channels are published.
import path from "node:path";
import { configureFileChangePublisher, publishFileChange } from "@mulmoclaude/core/file-change";
import type { Publisher } from "../infra/pubsub.js";

type PubSub = Publisher;

const log = {
  warn: (message: string, data?: Record<string, unknown>) => console.warn(`[file-change] ${message}`, data ?? ""),
};

// Scope matchers mirror what the host write sites ACCEPT, so a file can't save without
// refreshing. Both are now "any file of this type": presentDocument/presentHtml's `path`
// argument opens any `.md` / `.html` on disk (backends/openPath.ts), and the only callers
// of publishFileChange are those two save paths.
//
// Deliberate divergence from MulmoClaude, which still scopes markdown to its own
// `artifacts/markdowns/**` (server/events/file-change.ts): there, a View editing a repo
// file simply doesn't get the live-refresh event. Same widening belongs upstream; until
// it lands, MulmoTerminal refreshes in a case MulmoClaude doesn't.
function isMarkdownDoc(posixPath: string): boolean {
  return posixPath.endsWith(".md");
}

function isHtmlDoc(posixPath: string): boolean {
  return posixPath.endsWith(".html");
}

/** Configure the shared publisher against MulmoTerminal's pubsub + workspace. Call
 *  once at startup, before any write route runs. */
export function initFileChangePublisher(deps: { workspace: string; pubsub: PubSub | null }): void {
  const { workspace, pubsub } = deps;
  configureFileChangePublisher({
    publish: (channel, payload) => pubsub?.publish(channel, payload),
    workspaceRoot: workspace,
    // Normalise to POSIX so payload.path + channel suffix never drift on mixed
    // separators (our rels are already "/"-joined, so this is a no-op on POSIX).
    toPosix: (relativePath) => relativePath.split(path.sep).join("/"),
    pluginScopes: [
      { scope: "markdown", matches: isMarkdownDoc },
      { scope: "html", matches: isHtmlDoc },
    ],
    warn: (message, data) => log.warn(message, data),
  });
}

// Re-export so write backends import the publish from one place (and so they can't
// reach a differently-configured copy).
export { publishFileChange };
