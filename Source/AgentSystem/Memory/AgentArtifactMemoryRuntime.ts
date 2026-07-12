import path from "node:path";
import type { AgentHostToolHandler } from "../ToolRuntime/AgentToolHostCapabilityRegistry.js";
import type { AgentToolProcessRunResult } from "../ToolRuntime/AgentToolProcessRunner.js";
import { toolProcessFailureResult, toolProcessSuccessResult } from "../ToolRuntime/AgentToolProcessEnvelope.js";
import type { AgentSystemConfig } from "../Types/AgentConfigTypes.js";
import { AgentExecutionErrorCodes, AgentToolProcessErrorPhases } from "../Xml/AgentXmlStatus.js";
import { throwIfAborted } from "../Core/AgentCancellation.js";
import { resolveArtifactsConfig } from "../AgentDefaults.js";
import { assertInsideRoot } from "../Artifacts/AgentArtifactLocator.js";
import { indexArtifactManifests } from "./AgentArtifactManifestIndex.js";
import { readArtifactMemories } from "./AgentArtifactMemoryReader.js";
import { type ArtifactMemoryReadArguments, ArtifactMemoryReadArgumentsSchema } from "./AgentArtifactMemoryTypes.js";

export const readArtifactMemoryHostTool: AgentHostToolHandler = async (args, context) => {
  const parsed = ArtifactMemoryReadArgumentsSchema.safeParse(args);
  if (!parsed.success) {
    return artifactMemoryFailure({
      code: AgentExecutionErrorCodes.InvalidToolArguments,
      message: "ArtifactMemoryReadTool 参数无效。",
      details: {
        phase: AgentToolProcessErrorPhases.RuntimeExecution,
        issues: parsed.error.issues,
        toolName: context.tool.name,
      },
      diagnostics: parsed.error.issues.map((issue) => ({
        message: issue.message,
        pointer: `/${issue.path.join("/")}`,
        path: issue.path.map((entry) => (typeof entry === "number" ? entry : String(entry))),
      })),
    });
  }

  try {
    throwIfAborted(context.signal);
    const artifactRoot = resolveArtifactRoot(context.workspaceRoot, resolveArtifactsConfig(context.config).RootDir);
    const manifests = await indexArtifactManifests(artifactRoot, context.workspaceRoot);
    throwIfAborted(context.signal);
    const result = await readArtifactMemories(parsed.data, manifests, {
      workspaceRoot: context.workspaceRoot,
      artifactRoot,
      maxBytes: resolveArtifactReadMaxBytes(parsed.data, context.config),
    });
    return toolProcessSuccessResult(result);
  } catch (error) {
    return artifactMemoryFailure({
      code: AgentExecutionErrorCodes.PluginExecutionError,
      message: error instanceof Error ? error.message : String(error),
      details: {
        phase: AgentToolProcessErrorPhases.RuntimeExecution,
        toolName: context.tool.name,
      },
    });
  }
};

function resolveArtifactRoot(workspaceRoot: string, rootDir: string): string {
  return assertInsideRoot(workspaceRoot, path.resolve(workspaceRoot, rootDir), `artifact 根目录超出工作区：${rootDir}`);
}

function resolveArtifactReadMaxBytes(args: ArtifactMemoryReadArguments, config: AgentSystemConfig): number {
  const artifacts = resolveArtifactsConfig(config);
  return Math.min(args.maxBytesPerRef ?? artifacts.TextFileMaxBytes, artifacts.TextFileMaxBytes);
}

function artifactMemoryFailure(
  error: NonNullable<AgentToolProcessRunResult["response"]["error"]>,
): AgentToolProcessRunResult {
  return toolProcessFailureResult(error);
}
