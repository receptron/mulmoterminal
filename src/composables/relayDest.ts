// What a relay remembers its destination by (#3389), when the two cells may be on different machines
// (#3506). Pure.
//
// The mark is kept on the SOURCE's server, keyed by the destination's directory. A directory on the
// source's own machine keeps its bare path, the key it always had; one elsewhere carries its machine,
// since the same path on two machines is two directories. This machine, seen from a remote, is the
// empty host: a host id is never empty, so the two cannot meet.
const SEPARATOR = "\0";

export interface RelayEnd {
  cwd: string | null;
  /** The remote host the cell runs on, null or absent for this machine. */
  host?: string | null | undefined;
}

export function relayDestKey(source: RelayEnd, dest: RelayEnd): string | null {
  if (!dest.cwd) return null;
  const sourceHost = source.host ?? null;
  const destHost = dest.host ?? null;
  return sourceHost === destHost ? dest.cwd : `${destHost ?? ""}${SEPARATOR}${dest.cwd}`;
}
