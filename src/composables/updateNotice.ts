// The launcher's one-line update notice, split for the header badge: the whole line is the
// tooltip, and the command after "run: " is pulled out so the badge can offer to copy just
// that (`git pull` / `npm i -g mulmoterminal`). Null when there is nothing to show, so the
// badge renders nothing.
export interface UpdateBadge {
  text: string;
  command: string | null;
}

const RUN_MARKER = "run: ";

export function parseUpdateNotice(notice: string | null | undefined): UpdateBadge | null {
  if (!notice) return null;
  const at = notice.indexOf(RUN_MARKER);
  const command = at === -1 ? "" : notice.slice(at + RUN_MARKER.length).trim();
  return { text: notice, command: command || null };
}
