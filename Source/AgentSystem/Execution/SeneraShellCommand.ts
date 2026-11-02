export const SeneraShellDialects = {
  Posix: "posix-sh",
  PowerShell: "powershell",
} as const;

export type SeneraShellDialect = (typeof SeneraShellDialects)[keyof typeof SeneraShellDialects];

/**
 * Structural command value after the owning tool package has validated its
 * JSON Schema. Process infrastructure consumes it without becoming a second
 * public tool-contract parser.
 */
export interface SeneraShellCommandSpec {
  readonly mode: "shell";
  readonly dialect: SeneraShellDialect;
  readonly script: string;
}

export function isSeneraShellDialectCompatible(requested: SeneraShellDialect, available: SeneraShellDialect): boolean {
  return requested === available;
}
