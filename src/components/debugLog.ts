// TEMP debug — instrument the grid zoom/teleport to diagnose the vanishing cell.
// Logs to the console AND ships each line to the server (/api/_debug) so it lands
// in a file. REMOVE this module and its callers once the bug is found.
export function dbg(line: string) {
  const stamped = `${performance.now().toFixed(0)} ${line}`;
  // eslint-disable-next-line no-console
  console.log("[gridzoom]", stamped);
  fetch("/api/_debug", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ line: stamped }) }).catch(() => {});
}
