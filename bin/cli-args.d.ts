export type PortChoice = { port: number; explicit: boolean } | { error: string };
export type CwdChoice = { path: string; mustExist: boolean } | { error: string };
export declare function parsePortArg(args: string[], defaultPort: number): PortChoice;
export declare function chooseCwd(args: string[], env: Record<string, string | undefined>): CwdChoice;
export declare function portInUseMessage(port: number, explicit: boolean): string;
