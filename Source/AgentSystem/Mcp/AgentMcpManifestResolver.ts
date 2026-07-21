import fs from "node:fs";
import path from "node:path";
import { createAgentMcpNodeRuntimeLaunch } from "./AgentMcpNodeRuntime.js";
import { resolveNodePackageBin } from "./AgentMcpPackageResolver.js";
import type { PluginMcpServerManifest } from "../Types/PluginManifestTypes.js";

const NodeCommandTemplate = "${node}";
const TemplateResolvers = [
  {
    pattern: /\$\{node\}/g,
    resolve: () => process.execPath,
  },
  {
    pattern: /\$\{workspaceRoot\}/g,
    resolve: (context: AgentMcpManifestTemplateContext) => context.workspaceRoot,
  },
  {
    pattern: /\$\{pluginRoot\}/g,
    resolve: (context: AgentMcpManifestTemplateContext) => context.pluginRoot,
  },
] as const;

const PackageBinPattern = /\$\{packageBin:([^}:]+)(?::([^}]+))?\}/g;
const PackageBinCommandPattern = /^\$\{packageBin:([^}:]+)(?::([^}]+))?\}$/u;
const RuntimeModulePattern = /\$\{runtimeModule:([^}]+)\}/g;

export interface AgentMcpManifestTemplateContext {
  workspaceRoot: string;
  pluginRoot: string;
}

export interface ResolvedMcpServerManifest {
  id: string;
  command: string;
  args: string[];
  cwd: string;
  env?: Record<string, string>;
}

interface ResolvedMcpServerArgs {
  values: string[];
  requiresTsxLoader: boolean;
}

interface ResolvedRuntimeModulePath {
  value: string;
  requiresTsxLoader: boolean;
}

export function resolveMcpServerManifest(
  manifest: PluginMcpServerManifest,
  context: AgentMcpManifestTemplateContext,
): ResolvedMcpServerManifest {
  const args = resolveServerArgs(manifest.Args ?? [], context);
  const env = manifest.Env
    ? Object.fromEntries(Object.entries(manifest.Env).map(([key, value]) => [key, resolveTemplate(value, context)]))
    : undefined;
  const launch = resolveServerLaunch(manifest.Command, args, env, context);
  return {
    id: manifest.Id,
    command: launch.command,
    args: launch.args,
    cwd: resolvePathTemplate(manifest.Cwd ?? "${workspaceRoot}", context),
    env: launch.env,
  };
}

function resolveServerLaunch(
  commandTemplate: string,
  args: readonly string[],
  env: Record<string, string> | undefined,
  context: AgentMcpManifestTemplateContext,
): Pick<ResolvedMcpServerManifest, "command" | "args" | "env"> {
  if (commandTemplate === NodeCommandTemplate) {
    return createAgentMcpNodeRuntimeLaunch({ args, env });
  }

  if (PackageBinCommandPattern.test(commandTemplate)) {
    return createAgentMcpNodeRuntimeLaunch({ args: [resolveTemplate(commandTemplate, context), ...args], env });
  }

  return {
    command: resolveTemplate(commandTemplate, context),
    args: [...args],
    env,
  };
}

function resolveServerArgs(args: readonly string[], context: AgentMcpManifestTemplateContext): string[] {
  const resolved = args.reduce<ResolvedMcpServerArgs>(
    (state, arg) => {
      const next = resolveArgTemplate(arg, context);
      return {
        values: [...state.values, next.value],
        requiresTsxLoader: state.requiresTsxLoader || next.requiresTsxLoader,
      };
    },
    {
      values: [],
      requiresTsxLoader: false,
    },
  );

  return resolved.requiresTsxLoader ? ["--import", "tsx", ...resolved.values] : resolved.values;
}

function resolvePathTemplate(value: string, context: AgentMcpManifestTemplateContext): string {
  const resolved = resolveTemplate(value, context);
  return path.isAbsolute(resolved) ? path.normalize(resolved) : path.resolve(context.pluginRoot, resolved);
}

function resolveTemplate(value: string, context: AgentMcpManifestTemplateContext): string {
  return TemplateResolvers.reduce(
    (current, resolver) => current.replace(resolver.pattern, resolver.resolve(context)),
    value,
  ).replace(PackageBinPattern, (_match, packageName: string, binName: string | undefined) =>
    resolveNodePackageBin(packageName, binName),
  );
}

function resolveArgTemplate(value: string, context: AgentMcpManifestTemplateContext): ResolvedRuntimeModulePath {
  let requiresTsxLoader = false;
  const resolved = resolveTemplate(value, context).replace(RuntimeModulePattern, (_match, modulePath: string) => {
    const runtimeModule = resolveRuntimeModulePath(context.workspaceRoot, modulePath);
    requiresTsxLoader = requiresTsxLoader || runtimeModule.requiresTsxLoader;
    return runtimeModule.value;
  });

  return {
    value: resolved,
    requiresTsxLoader,
  };
}

function resolveRuntimeModulePath(workspaceRoot: string, modulePath: string): ResolvedRuntimeModulePath {
  const distPath = path.resolve(workspaceRoot, "Dist", modulePath);
  const sourcePath = path.resolve(workspaceRoot, modulePath.replace(/\.js$/u, ".ts"));
  const useSource = process.argv.some((arg) => arg.includes("tsx")) || !fs.existsSync(distPath);
  return useSource
    ? {
        value: sourcePath,
        requiresTsxLoader: true,
      }
    : {
        value: distPath,
        requiresTsxLoader: false,
      };
}
