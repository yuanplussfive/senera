import path from "node:path";
import { pathToFileURL } from "node:url";
import fg from "fast-glob";
import { resolveAgentDefaults } from "../Source/AgentSystem/AgentDefaults.js";
import { AgentJsonFileLoader } from "../Source/AgentSystem/Config/AgentJsonFileLoader.js";
import {
  normalizeSandboxImages,
  prepareAgentSandboxRuntime,
  type MicrosandboxModule,
} from "../Source/AgentSystem/Sandbox/AgentSandboxRuntimePreparation.js";
import { PluginManifestSchema } from "../Source/AgentSystem/Schemas/PluginManifestSchema.js";
import { resolveAgentNodePluginRuntimeImage } from "../Source/AgentSystem/ToolRuntime/AgentPluginProcessExecutionProfile.js";
import type { ResolvedAgentSandboxRuntimeConfig } from "../Source/AgentSystem/Types/AgentConfigTypes.js";
import type { PluginManifest } from "../Source/AgentSystem/Types/PluginManifestTypes.js";

export interface PrepareOptions {
  strict: boolean;
  skipImagePull: boolean;
  importBundles: boolean;
  baseDir?: string;
  bundleDir?: string;
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

export async function prepareSandboxRuntime(options: PrepareOptions, microsandbox?: MicrosandboxModule): Promise<void> {
  const config = buildSandboxRuntimeConfig(options);
  const images = normalizeSandboxImages(config.Images, discoverSandboxImages());
  process.stdout.write(`sandbox images: ${images.join(", ")}\n`);
  await prepareAgentSandboxRuntime({
    workspaceRoot,
    config,
    images,
    strict: options.strict,
    skipImagePull: options.skipImagePull,
    importBundles: options.importBundles,
    exportBundlePath: options.exportBundlePath,
    microsandbox,
    log: (message) => process.stdout.write(`${message}\n`),
  });
}

export function discoverSandboxImages(): string[] {
  const images = new Set<string>();
  for (const manifestPath of discoverPluginManifestPaths()) {
    const manifest = new AgentJsonFileLoader().load(manifestPath, PluginManifestSchema) as PluginManifest;
    const sandboxTool = (manifest.Tools ?? []).some(
      (tool) => tool.Execution.Boundary === "Sandbox" || tool.Execution.Boundary === "SandboxPreferred",
    );
    if (sandboxTool && manifest.Plugin.Entry?.Kind === "Process") {
      images.add(resolveAgentNodePluginRuntimeImage(manifest.Runtime));
    }
  }

  return [...images].sort((left, right) => left.localeCompare(right));
}

export function readOptions(args: readonly string[]): PrepareOptions {
  return {
    strict: args.includes("--strict"),
    skipImagePull: args.includes("--skip-image-pull"),
    importBundles: args.includes("--import-bundles"),
    baseDir: readOptionValue(args, "--base-dir"),
    bundleDir: readOptionValue(args, "--bundle-dir"),
    exportBundlePath: readOptionValue(args, "--export-bundle"),
  };
}

function buildSandboxRuntimeConfig(options: PrepareOptions): ResolvedAgentSandboxRuntimeConfig {
  const defaults = resolveAgentDefaults(undefined).SandboxRuntime;
  return {
    ...defaults,
    BaseDir: options.baseDir ?? defaults.BaseDir,
    BundleDir: options.bundleDir ?? defaults.BundleDir,
  };
}

function discoverPluginManifestPaths(): string[] {
  return fg
    .sync(["System/Plugins/*/PluginManifest.json", "Plugins/*/PluginManifest.json"], {
      cwd: workspaceRoot,
      absolute: true,
      onlyFiles: true,
    })
    .sort((left, right) => left.localeCompare(right));
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
