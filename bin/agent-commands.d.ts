export interface AgentCommand {
  agent: string;
  cmd: string;
  env: string;
  hint: string;
}
export declare const AGENT_COMMANDS: readonly AgentCommand[];
export declare function agentBin(agentCommand: AgentCommand, env: NodeJS.ProcessEnv): string;
export declare function installedAgents(env: NodeJS.ProcessEnv, probe: (bin: string) => boolean): AgentCommand[];
