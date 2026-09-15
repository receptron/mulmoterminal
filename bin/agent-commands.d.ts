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
