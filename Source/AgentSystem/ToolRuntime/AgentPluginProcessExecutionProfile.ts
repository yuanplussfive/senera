import path from "node:path";
import type { SeneraProcessExecutionProfile, SeneraProcessWritableMount } from "../Execution/SeneraExecutionProfile.js";
import { projectHostPathToGuestPath } from "../Execution/SeneraGuestPathProjection.js";
import type { RegisteredTool } from "../Types/PluginRuntimeTypes.js";
import { resolveAgentToolExecutionPolicy } from "./AgentToolExecutionPolicy.js";

const NodePluginRuntimeDefaults = {
  nodeVersion: "22",
  packageManager: "npm",
  sandboxProfile: "node-plugin",
  imageVariant: "bookworm-slim",
  guestWorkspaceRoot: "/workspace",
  guestRuntimeRoot: "/opt/senera/runtime",
  defaultStateQuotaMiB: 256,
} as const;

export function resolveAgentNodePluginRuntimeImage(runtime: {
  NodeVersion?: string;
} | undefined): string {
  return nodeRuntimeImage(runtime?.NodeVersion ?? NodePluginRuntimeDefaults.nodeVersion);
}

export interface AgentPluginProcessExecutionPlan {
  profile: SeneraProcessExecutionProfile;
  guestContext: {
    workspaceRoot: string;
    pluginRoot: string;
  };
}

export function buildAgentPluginProcessExecutionPlan(input: {
  workspaceRoot: string;
  tool: RegisteredTool;
}): AgentPluginProcessExecutionPlan {
  const plugin = input.tool.plugin;
  const runtime = plugin.manifest.Runtime;
  const sandbox = plugin.manifest.Sandbox;
  const nodeVersion = runtime?.NodeVersion ?? NodePluginRuntimeDefaults.nodeVersion;
  const sandboxProfile = runtime?.SandboxProfile ?? NodePluginRuntimeDefaults.sandboxProfile;
  const executionPolicy = resolveAgentToolExecutionPolicy(input.tool);
  if (executionPolicy.mode === "local") {
    return {
      profile: {
        name: sandboxProfile,
        kind: "plugin-process",
        backend: "local",
        localFallback: executionPolicy.localFallback,
      },
      guestContext: {
        workspaceRoot: path.resolve(input.workspaceRoot),
        pluginRoot: path.resolve(plugin.rootPath),
      },
    };
  }

  const guestPluginRoot = guestWorkspaceRelativePath(input.workspaceRoot, plugin.rootPath);

  return {
    profile: {
      name: sandboxProfile,
      kind: "plugin-process",
      backend: "sandbox",
      localFallback: executionPolicy.localFallback,
      microsandbox: {
        image: resolveAgentNodePluginRuntimeImage(runtime),
        guestWorkspaceRoot: NodePluginRuntimeDefaults.guestWorkspaceRoot,
        guestWorkdir: guestPluginRoot,
        network: executionPolicy.network,
        workspaceMount: executionPolicy.workspaceMount,
        writableMounts: projectWritableMounts({
          workspaceRoot: input.workspaceRoot,
          pluginRoot: plugin.rootPath,
          paths: [
            ...(sandbox?.Workspace?.Write ?? []),
            ...(sandbox?.State?.Write ?? []),
          ],
        }),
        rootfsBundles: [{
          workspaceRoot: input.workspaceRoot,
          packageRoot: plugin.rootPath,
          guestPath: NodePluginRuntimeDefaults.guestRuntimeRoot,
        }],
        env: {
          SENERA_TOOL_CONTEXT_WORKSPACE_ROOT: NodePluginRuntimeDefaults.guestWorkspaceRoot,
          SENERA_TOOL_CONTEXT_PLUGIN_ROOT: guestPluginRoot,
        },
      },
    },
    guestContext: {
      workspaceRoot: NodePluginRuntimeDefaults.guestWorkspaceRoot,
      pluginRoot: guestPluginRoot,
    },
  };
}

function nodeRuntimeImage(nodeVersion: string): string {
  return `node:${nodeVersion}-${NodePluginRuntimeDefaults.imageVariant}`;
}

function projectWritableMounts(input: {
  workspaceRoot: string;
  pluginRoot: string;
  paths: readonly string[];
}): SeneraProcessWritableMount[] {
  return input.paths
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => ({
      value,
      hostPath: path.isAbsolute(value)
        ? path.resolve(value)
        : path.resolve(input.pluginRoot, value),
    }))
    .filter(({ hostPath }) => isPathInside(input.workspaceRoot, hostPath))
    .map((value) => resolvePluginWritableMount({
      workspaceRoot: input.workspaceRoot,
      pluginRoot: input.pluginRoot,
      hostPath: value.hostPath,
    }));
}

function resolvePluginWritableMount(input: {
  workspaceRoot: string;
  pluginRoot: string;
  hostPath: string;
}): SeneraProcessWritableMount {
  return {
    hostPath: input.hostPath,
    guestPath: projectHostPathToGuestPath({
      hostRoot: input.workspaceRoot,
      hostPath: input.hostPath,
      guestRoot: NodePluginRuntimeDefaults.guestWorkspaceRoot,
    }),
    quotaMiB: NodePluginRuntimeDefaults.defaultStateQuotaMiB,
  };
}

function guestWorkspaceRelativePath(workspaceRoot: string, value: string): string {
  return projectHostPathToGuestPath({
    hostRoot: workspaceRoot,
    hostPath: value,
    guestRoot: NodePluginRuntimeDefaults.guestRuntimeRoot,
  });
}

function isPathInside(root: string, value: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(value));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
