// The session relay wired to the user's config.json and this server's version, for server/index.ts.
import { APP_CONFIG_FILE } from "../../config/config-routes.js";
import { getUpdateStatus } from "../../config/update-status.js";
import { isUsableHost, loadRemoteHosts } from "./remoteHostsRoutes.js";
import { startRemoteSessionsRelay, type RemoteSessionsRelayDeps } from "./remoteSessionsRelay.js";

export const configuredRemoteSessionsRelay = (publish: RemoteSessionsRelayDeps["publish"]) =>
  startRemoteSessionsRelay({
    hosts: () => loadRemoteHosts(APP_CONFIG_FILE).hosts,
    usable: (host) => isUsableHost(host, getUpdateStatus().version),
    publish,
  });
