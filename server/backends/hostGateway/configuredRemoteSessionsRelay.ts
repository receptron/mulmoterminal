// The session relay wired to the user's config.json and this server's version, for server/index.ts.
import { APP_CONFIG_FILE } from "../../config/config-routes.js";
import { getUpdateStatus } from "../../config/update-status.js";
import { isUsableHost, loadRemoteHosts } from "./remoteHostsRoutes.js";
import { parseRemoteSessionChannel } from "../../../common/remoteHosts.js";
import { SESSION_ID_RE } from "../../config/env.js";
import { startRemoteSessionsRelay, type RemoteSessionsRelay, type RemoteSessionsRelayDeps } from "./remoteSessionsRelay.js";

export const configuredRemoteSessionsRelay = (publish: RemoteSessionsRelayDeps["publish"]): RemoteSessionsRelay =>
  startRemoteSessionsRelay({
    hosts: () => loadRemoteHosts(APP_CONFIG_FILE).hosts,
    usable: (host) => isUsableHost(host, getUpdateStatus().version),
    publish,
  });

/** The part of this server's pub/sub that says when a channel gains its first and loses its last listener. */
export interface SubscriptionSource {
  onSubscriptionChange: (listener: (channel: string, subscribed: boolean) => void) => () => void;
}

/** A browser listening to a remote session's channel (`remote:<host>:<kind>:<id>`) is what makes the
 *  relay follow it on that host, and its last one leaving is what stops it (#3506). */
export const followRemoteSessionChannels = (source: SubscriptionSource, relay: Pick<RemoteSessionsRelay, "follow" | "unfollow">): (() => void) =>
  source.onSubscriptionChange((room, subscribed) => {
    const target = parseRemoteSessionChannel(room, (id) => SESSION_ID_RE.test(id));
    if (target === null) return;
    if (subscribed) relay.follow(target.host, target.channel);
    else relay.unfollow(target.host, target.channel);
  });
