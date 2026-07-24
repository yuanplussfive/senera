import path from "node:path";
import { pathToFileURL } from "node:url";
import { resolveAgentDefaults } from "../Source/AgentSystem/AgentDefaults.js";
import {
  prepareAgentSandboxRuntime,
  type MicrosandboxModule,
} from "../Source/AgentSystem/Sandbox/AgentSandboxRuntimePreparation.js";
import type { ResolvedAgentSandboxRuntimeConfig } from "../Source/AgentSystem/Types/AgentConfigTypes.js";
import { prepareSeneraTerminalSidecarGuestRuntime } from "./PrepareTerminalSidecarGuestRuntime.js";

export interface PrepareOptions {
  baseDir?: string;
  exportBundlePath?: string;
}

const workspaceRoot = process.cwd();

if (isEntrypoint(import.meta.url, process.argv[1])) {
  const options = readOptions(process.argv.slice(2));
  await prepareSandboxRuntime(options);
}

export async function prepareSandboxRuntime(
  options: PrepareOptions,
  microsandbox?: MicrosandboxModule,
  prepareTerminalRuntime: typeof prepareSeneraTerminalSidecarGuestRuntime = prepareSeneraTerminalSidecarGuestRuntime,
): Promise<void> {
  const config = buildSandboxRuntimeConfig(options);
  process.stdout.write(`sandbox provisioning: ${config.Provisioning.Kind}\n`);
  const prepared = await prepareAgentSandboxRuntime({
    workspaceRoot,
    config,
    exportBundlePath: options.exportBundlePath,
    microsandbox,
    log: (message) => process.stdout.write(`${message}\n`),
  });
  await prepareTerminalRuntime({
    workspaceRoot,
    sandboxRuntimeBaseDir: prepared.paths.baseDir,
    log: (message) => process.stdout.write(`${message}\n`),
  });
}

export function readOptions(args: readonly string[]): PrepareOptions {
  return {
    baseDir: readOptionValue(args, "--base-dir"),
    exportBundlePath: readOptionValue(args, "--export-bundle"),
  };
}

function buildSandboxRuntimeConfig(options: PrepareOptions): ResolvedAgentSandboxRuntimeConfig {
  const defaults = resolveAgentDefaults(undefined).SandboxRuntime;
  return {
    ...defaults,
    BaseDir: options.baseDir ?? defaults.BaseDir,
  };
}

function readOptionValue(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name);
  const value = index >= 0 ? args[index + 1] : undefined;
  return value?.trim() || undefined;
}

function isEntrypoint(moduleUrl: string, argvPath: string | undefined): boolean {
  return argvPath !== undefined && pathToFileURL(path.resolve(argvPath)).href === moduleUrl;
}
