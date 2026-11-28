// Opens a Shell cell on the scratch server that `verify-scratch.ts start --home <H>` launched, types
// a harmless marker, waits until tmux itself shows its output, and screenshots the page.
//   node drive-shell.mjs <dir holding node_modules/playwright> <H> <screenshot.png>
// The terminal is drawn on a canvas, so the page has no text to wait on: every wait is on tmux.
// The port and socket come from `doctor`, which identifies the server and recomputes the socket,
// never from the state file: a stale or edited one could point at the live server.
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MARKER = "VERIFY_MARKER_3593";
const STEP_TIMEOUT_MS = 15_000;
const POLL_MS = 250;

const CHECKOUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const [, , playwrightDir, home, shotPath] = process.argv;

// doctor exits non-zero unless the launcher and the server are identified as this scratch HOME's.
function identifiedServer() {
  const helper = path.join(CHECKOUT, "scripts", "verify-scratch.ts");
  try {
    return JSON.parse(execFileSync(process.execPath, ["--import", "tsx", helper, "doctor", "--home", home], { cwd: CHECKOUT, encoding: "utf8" }));
  } catch {
    console.error("drive-shell: doctor did not identify this scratch server; refusing to drive");
    process.exit(1);
  }
}

const { port, socketPath } = identifiedServer();
const { chromium } = createRequire(`${playwrightDir}/`)("playwright");

function tmux(...args) {
  try {
    return execFileSync("tmux", ["-S", socketPath, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return "";
  }
}

async function until(what, condition) {
  const deadline = Date.now() + STEP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const value = condition();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  throw new Error(`timed out waiting for ${what}`);
}

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.click('[data-testid="agent-picker-shell"]', { timeout: STEP_TIMEOUT_MS });
  await page.click('[data-testid="cell-dir-go"]', { timeout: STEP_TIMEOUT_MS });
  const session = await until("the cell's tmux session", () => tmux("list-sessions", "-F", "#{session_name}").split("\n")[0]);
  await page.locator(".xterm").first().click();
  await page.keyboard.type(`echo ${MARKER}`);
  await page.keyboard.press("Enter");
  await until("the marker's output", () =>
    tmux("capture-pane", "-p", "-t", session)
      .split("\n")
      .some((line) => line.trim() === MARKER),
  );
  await page.screenshot({ path: shotPath });
  console.log(JSON.stringify({ session, screenshot: shotPath }));
} finally {
  await browser.close();
}
