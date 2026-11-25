// The remote-host upgrade handler wired to the user's config.json, for the upgrade listener.
import { APP_CONFIG_FILE } from "../../config/config-routes.js";
import { loadRemoteHosts } from "./remoteHostsRoutes.js";
import { createRemoteUpgradeHandler, type RemoteUpgradeDeps } from "./remoteUpgrade.js";

export const configuredRemoteUpgrade = (isAllowedOrigin: RemoteUpgradeDeps["isAllowedOrigin"]) =>
  createRemoteUpgradeHandler({ isAllowedOrigin, remoteHosts: () => loadRemoteHosts(APP_CONFIG_FILE).hosts });
