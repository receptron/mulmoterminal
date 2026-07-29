import readline from "node:readline";

const port = process.env.MULMOTERMINAL_PORT || "34567";
const sessionId = process.env.MULMOTERMINAL_SESSION_ID;
const group = process.env.MULMOTERMINAL_TOOL_GROUP;

if (!sessionId) {
  process.stderr.write("[mcp-bridge] Missing MULMOTERMINAL_SESSION_ID\n");
  process.exit(1);
}

const targetUrl = group
  ? `http://127.0.0.1:${port}/api/mcp/${group}/${sessionId}`
  : `http://127.0.0.1:${port}/api/mcp/${sessionId}`;

const rl = readline.createInterface({
  input: process.stdin,
  terminal: false,
});

rl.on("line", async (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  try {
    const payload = JSON.parse(trimmed);
    const res = await fetch(targetUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      const data = await res.text();
      if (data) {
        process.stdout.write(data + "\n");
      }
    }
  } catch (err) {
    process.stderr.write(`[mcp-bridge error] ${err}\n`);
  }
});
