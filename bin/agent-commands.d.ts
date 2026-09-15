export interface AgentCommand {
  agent: string;
  cmd: string;
  env: string;
  hint: string;
}
export declare const AGENT_COMMANDS: readonly AgentCommand[];
export declare function agentBin(agentCommand: AgentCommand, env: NodeJS.ProcessEnv): string;
export declare function installedAgents(env: NodeJS.ProcessEnv, probe: (bin: string) => boolean): AgentCommand[];
export declare function namesAPath(bin: string): boolean;
export interface AgentRunProbe {
  isFile: (candidate: string) => boolean;
  isExecutable: (candidate: string) => boolean;
  runsOnPath: (name: string) => boolean;
}
export declare function canRun(bin: string, probe: AgentRunProbe, platform: NodeJS.Platform): boolean;
export declare function isPlainCommandName(bin: string): boolean;
export declare function couldBeABinary(bin: string): boolean;
export declare function firstInstalledAgent(env: NodeJS.ProcessEnv, probe: (bin: string) => boolean): AgentCommand | null;
export declare function isRunScriptPathEntry(entry: string, platform?: NodeJS.Platform): boolean;
export declare function searchPathForProbe(pathValue: string | undefined, delimiter: string, platform?: NodeJS.Platform): string;
export declare function probeEnvFrom(env: NodeJS.ProcessEnv, delimiter: string, platform?: NodeJS.Platform): NodeJS.ProcessEnv;
