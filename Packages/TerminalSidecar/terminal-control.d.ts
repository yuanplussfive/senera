export type TerminalControlSignal = "interrupt" | "terminate" | "kill";

export interface TerminalControlTarget {
  write(input: string): void;
  kill(signal?: "SIGINT" | "SIGTERM" | "SIGKILL"): void;
}

export declare function applyTerminalSignal(
  terminal: TerminalControlTarget,
  signal: TerminalControlSignal,
  platform?: NodeJS.Platform,
): void;
