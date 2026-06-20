// Workspace file-change publisher — thin host binding over
// @mulmoclaude/file-change-publisher (shared with MulmoClaude). A write route
// calls `publishFileChange(rel)` after a successful write; the package stats the
// post-write mtime, contains the path to the workspace, and forwards to the
// plugin-scoped channels the open Views subscribe to (markdown / html).
//
// MulmoTerminal has no general "files explorer" subscriber, so there's no
// primaryChannel — only the plugin scopes. The frontend plugin runtime
// subscribes via runtime.pubsub("file:<path>") → "plugin:<scope>:file:<path>"
// (src/composables/pluginRuntime.ts: pluginChannelName), which is exactly the
// channel the package's pluginFileChannel produces.

import path from "node:path";
import { configureFileChangePublisher, publishFileChange } from "@mulmoclaude/file-change-publisher";
import type { createPubSub } from "../pubsub.js";

type PubSub = ReturnType<typeof createPubSub>;

const DOCS_DIR = "artifacts/documents";

export function initFileChangePublisher(deps: { workspace: string; pubsub: PubSub | null }): void {
  configureFileChangePublisher({
    publish: (channel, payload) => deps.pubsub?.publish(channel, payload),
    workspaceRoot: deps.workspace,
    // MT workspace-relative paths are already POSIX (forward-slash); split on the
    // platform separator defensively so the channel suffix can't drift on Windows.
    toPosix: (rel) => rel.split(path.sep).join("/"),
    pluginScopes: [
      // Matches the markdown backend's isDocPath gate (artifacts/documents/**.md).
      { scope: "markdown", matches: (rel) => rel.startsWith(`${DOCS_DIR}/`) && rel.endsWith(".md") },
      // presentHtml pages live under artifacts/html/**.html.
      { scope: "html", matches: (rel) => rel.endsWith(".html") },
    ],
    warn: (message, data) => console.warn(`[file-change] ${message}`, data ?? ""),
  });
}

export { publishFileChange };
