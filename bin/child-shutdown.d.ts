export declare const SHUTDOWN_MESSAGE_TYPE = "shutdown";
export declare function isShutdownMessage(message: unknown): boolean;
export interface StoppableChild {
  connected: boolean;
  send: (message: unknown, callback: (error: Error | null) => void) => boolean;
  kill: (signal?: NodeJS.Signals) => boolean;
}
export declare function askChildToStop(child: StoppableChild): void;
export interface ParentShutdownOptions {
  graceMs?: number;
  exit?: (code: number) => void;
  on?: (signal: NodeJS.Signals, listener: () => void) => void;
  onStopping?: () => void;
}
/** What the parent's shutdown reads of its child — a ChildProcess satisfies it. */
export interface SupervisedChild extends StoppableChild {
  exitCode: number | null;
  signalCode: NodeJS.Signals | null;
  once: (event: "close", listener: () => void) => unknown;
}
export declare const CHILD_EXIT_GRACE_MS: number;
export declare function stopChildWithin(child: SupervisedChild, graceMs: number, onGone?: () => void): void;
export declare function installParentShutdown(getChild: () => SupervisedChild | null, options?: ParentShutdownOptions): void;
