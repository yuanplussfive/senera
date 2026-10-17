import process from "node:process";
import { z } from "zod";

export const AgentSystemExtensionPlatformValues = [
  "aix",
  "android",
  "cygwin",
  "darwin",
  "freebsd",
  "haiku",
  "linux",
  "netbsd",
  "openbsd",
  "sunos",
  "win32",
] as const satisfies readonly NodeJS.Platform[];

export const AgentSystemExtensionPlatformSchema = z.enum(AgentSystemExtensionPlatformValues);
export type AgentSystemExtensionPlatform = z.infer<typeof AgentSystemExtensionPlatformSchema>;

export function isAgentSystemExtensionApplicable(
  platforms: readonly AgentSystemExtensionPlatform[] | undefined,
  platform: AgentSystemExtensionPlatform = process.platform,
): boolean {
  return platforms === undefined || platforms.includes(platform);
}
