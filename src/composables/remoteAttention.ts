// A remote host's session row (#3506), as the attention player reads a `sessions` row. Its id becomes
// remoteSessionKey(host, id), so the player's previous-state map and the missed marks hold remote
// sessions apart from this machine's, and its cwd is dropped: the directory's own sound is looked
// up by path on THIS machine, where a remote path names nothing, so the global sound plays instead.
import { remoteSessionKey, type RemoteSessionRowMessage } from "../../common/remoteHosts";

export const remoteRowForAttention = ({ host, row }: RemoteSessionRowMessage) => ({ ...row, id: remoteSessionKey(host, row.id), cwd: null });
