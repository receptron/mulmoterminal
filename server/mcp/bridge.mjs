// A stdio MCP server that forwards to this server's in-process GUI MCP over HTTP.
//
// claude and codex are handed a per-session URL at spawn (`--mcp-config`, `-c mcp_servers.…`),
// so nothing like this is needed for them. `agy` takes no such flag: it reads MCP servers from
// a FILE, and the only file it reads per project is `.agents/mcp_config.json` — one per
// DIRECTORY, shared by every session running there. So the session id cannot ride in the URL.
// It rides the agy process's environment instead (guiMcpEnv, set per spawn), and this bridge —
// which agy spawns as a child of that process — reads it from there.
//
// Plain .mjs, not TypeScript: node resolves a bare `--import tsx` against the CHILD's cwd, which
// is the user's project and has no tsx. Nothing here needs compiling, so nothing does.
import { createInterface } from "node:readline";

// The GROUP is static per server entry and comes from the config file's own `env` block; the
// SESSION is dynamic and comes from the agy process this was spawned by. That split is the whole
// reason one shared file can serve every session in a directory.
const port = process.env.MULMOTERMINAL_PORT;
const sessionId = process.env.MULMOTERMINAL_SESSION_ID;
const group = process.env.MULMOTERMINAL_TOOL_GROUP;
const url = `http://127.0.0.1:${port}/api/mcp/${group}/${sessionId}`;

const send = (message) => process.stdout.write(JSON.stringify(message) + "\n");

// An id means a RESPONSE is owed; without one the message is a notification, and silence is the
// correct answer even when it failed. Every failure path answers, because an unanswered request
// leaves agy reporting "still connecting" for the life of the session rather than an error.
const fail = (id, message) => {
  if (id !== undefined && id !== null) send({ jsonrpc: "2.0", id, error: { code: -32603, message } });
};

// The server replies as SSE (`data: {…}` lines) or as plain JSON, and with an empty 202 for a
// notification — which yields nothing to forward, correctly.
function responses(body) {
  const trimmed = body.trim();
  if (trimmed === "") return [];
  if (trimmed.startsWith("{")) return [trimmed];
  return body
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => line.slice(6).trim())
    .filter(Boolean);
}

createInterface({ input: process.stdin, terminal: false }).on("line", async (line) => {
  if (line.trim() === "") return;
  let id;
  try {
    id = JSON.parse(line).id;
    if (!sessionId) return fail(id, "mulmoterminal: no session — this MCP server only runs inside a mulmoterminal session");
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: line,
    });
    if (!res.ok) return fail(id, `mulmoterminal returned HTTP ${res.status}`);
    for (const response of responses(await res.text())) process.stdout.write(response + "\n");
  } catch (err) {
    fail(id, `mulmoterminal is unreachable: ${err}`);
  }
});
