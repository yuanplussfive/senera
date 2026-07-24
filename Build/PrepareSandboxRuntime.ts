import path from "node:path";
import { pathToFileURL } from "node:url";
import { resolveAgentDefaults } from "../Source/AgentSystem/AgentDefaults.js";
import {
  normalizeSandboxImages,
  prepareAgentSandboxRuntime,
  type MicrosandboxModule,
} from "../Source/AgentSystem/Sandbox/AgentSandboxRuntimePreparation.js";
import type { ResolvedAgentSandboxRuntimeConfig } from "../Source/AgentSystem/Types/AgentConfigTypes.js";
import { prepareSeneraTerminalSidecarGuestRuntime } from "./PrepareTerminalSidecarGuestRuntime.js";

export interface PrepareOptions {
  strict: boolean;
  skipImagePull: boolean;
  baseDir?: string;
  exportBundlePath?: string;
}

const workspaceRoot = process.cwd();

if (isEntrypoint(import.meta.url, process.argv[1])) {
  const options = readOptions(process.argv.slice(2));
  await prepareSandboxRuntime(options).catch((error) => {
    if (options.strict) {
      throw error;
    }

    process.stdout.write(`sandbox prepare skipped: ${errorMessage(error)}\n`);
  });
}

export async function prepareSandboxRuntime(
  options: PrepareOptions,
  microsandbox?: MicrosandboxModule,
  prepareTerminalRuntime: typeof prepareSeneraTerminalSidecarGuestRuntime = prepareSeneraTerminalSidecarGuestRuntime,
): Promise<void> {
  const config = buildSandboxRuntimeConfig(options);
  const images = normalizeSandboxImages(config.Images);
  process.stdout.write(`sandbox images: ${images.join(", ")}\n`);
  const prepared = await prepareAgentSandboxRuntime({
    workspaceRoot,
    config,
    images,
    strict: options.strict,
    skipImagePull: options.skipImagePull,
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
    strict: args.includes("--strict"),
    skipImagePull: args.includes("--skip-image-pull"),
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isEntrypoint(moduleUrl: string, argvPath: string | undefined): boolean {
  return argvPath !== undefined && pathToFileURL(path.resolve(argvPath)).href === moduleUrl;
}
