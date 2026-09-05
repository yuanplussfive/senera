import { z } from "zod";

export const SeneraShellDialects = {
  Posix: "posix-sh",
  PowerShell: "powershell",
} as const;

export type SeneraShellDialect = (typeof SeneraShellDialects)[keyof typeof SeneraShellDialects];

export const SeneraShellCommandSpecSchema = z
  .object({
    mode: z.literal("shell"),
    dialect: z.enum([SeneraShellDialects.Posix, SeneraShellDialects.PowerShell]),
    script: z.string().trim().min(1),
  })
  .strict();

export type SeneraShellCommandSpec = z.infer<typeof SeneraShellCommandSpecSchema>;

export function isSeneraShellDialectCompatible(requested: SeneraShellDialect, available: SeneraShellDialect): boolean {
  return requested === available;
}
