// Strip a leading `@scope/` from a package name for a compact meta line: `@scope/foo/bar`
// becomes `foo/bar`. A bare `@scope/` with nothing after it has no shorter form, so the
// original is kept rather than collapsing to "". Unscoped names pass through unchanged.
export function shortPkg(pluginPkg: string): string {
  if (!pluginPkg.startsWith("@")) return pluginPkg;
  return pluginPkg.split("/").slice(1).join("/") || pluginPkg;
}
