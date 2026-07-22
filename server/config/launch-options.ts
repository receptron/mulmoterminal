// What the launch form may offer: the backends this server can actually reach right now,
// each with the models it can run (#584).
//
// Kept pure — providers and the environment come in as arguments — because the interesting
// part is the decision, not the reading: which backend is offerable, and what to tell the
// user about one that isn't. A provider that is configured but missing its token still
// appears, carrying the same sentence a session would have refused with, so the help can
// name the one thing to fix instead of describing the whole setup.
import { presetsForProvider, type ModelPreset } from "../../common/modelPresets.js";
import { usableProvider, type ProviderConfig } from "../session/provider-env.js";

export interface LaunchProviderOption {
  id: string;
  label: string;
  // False when this server cannot start a session on it as configured.
  ready: boolean;
  // Why not, in resolveProvider's own words. Absent when ready.
  reason?: string;
  // The env var this provider's key is read from — the help needs to name it, and it is
  // the NAME, never the value.
  tokenEnv: string;
  models: ModelPreset[];
}

export interface LaunchOptions {
  providers: LaunchProviderOption[];
  // True when at least one provider can be launched on. The picker hides itself otherwise:
  // with no reachable backend there is nothing to choose between, only setup to explain.
  anyReady: boolean;
}

export function launchOptions(providers: readonly ProviderConfig[], env: NodeJS.ProcessEnv): LaunchOptions {
  const options = providers.map((provider): LaunchProviderOption => {
    const usable = usableProvider(provider, env);
    return {
      id: provider.id,
      label: provider.label,
      ready: usable.ok,
      ...(usable.ok ? {} : { reason: usable.reason }),
      tokenEnv: provider.tokenEnv,
      models: presetsForProvider(provider.id, provider.models ?? []),
    };
  });
  return { providers: options, anyReady: options.some((option) => option.ready) };
}
