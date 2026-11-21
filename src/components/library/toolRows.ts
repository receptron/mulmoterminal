// How the tools kind names an instruction file (#3332): by its path under the chosen directory when it
// is there, whole when it is elsewhere (the user's, a parent's, the managed one).

export function instructionLabel(file: { path: string }, cwd: string): string {
  const base = cwd.slice(
    0,
    cwd.split("").reduce((end, char, at) => (char === "/" || char === "\\" ? end : at + 1), 0),
  );
  const inside = base !== "" && (file.path.startsWith(`${base}/`) || file.path.startsWith(`${base}\\`));
  return inside ? file.path.slice(base.length + 1) : file.path;
}
