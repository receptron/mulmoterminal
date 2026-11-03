// `yarn dev`: the backend supervisor and Vite together. See dev-plan.js for why Windows does not go
// through `concurrently`.
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { combinedExitCode, devRunPlan } from "./dev-plan.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// By path, so this also runs as `node scripts/dev.mjs`, outside the PATH yarn sets up.
const CONCURRENTLY = path.join(ROOT, "node_modules", ".bin", "concurrently");

const plan = devRunPlan(process.platform, process.env);

// No shell anywhere: `concurrently`'s arguments hold spaces, and a shell on Windows is the batch
// prompt dev-plan.js describes.
const children =
  plan.kind === "concurrently"
    ? [spawn(CONCURRENTLY, plan.args, { cwd: ROOT, stdio: "inherit" })]
    : plan.scripts.map(({ script }) => spawn(process.execPath, [path.resolve(ROOT, script)], { cwd: ROOT, stdio: "inherit" }));

// Ctrl+C reaches every process in the terminal, these children included, and each stops itself —
// the backend only after it has flushed what it owes the disk. So it is not passed on, and this
// process does not leave before them. A SIGTERM is aimed at this process alone, so it is.
process.on("SIGINT", () => {});
process.on("SIGTERM", () => children.forEach((child) => child.kill("SIGTERM")));

// A command that cannot be started at all counts as a failed one rather than crashing the rest.
const ended = (child) =>
  new Promise((resolve) => {
    child.on("exit", (code) => resolve(code));
    child.on("error", (error) => {
      console.error(`[dev] could not start: ${error.message}`);
      resolve(1);
    });
  });
const codes = await Promise.all(children.map(ended));
process.exit(combinedExitCode(codes));
