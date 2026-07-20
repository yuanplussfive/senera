import path from "node:path";
import type { AgentHostToolHandler } from "../ToolRuntime/AgentToolHostCapabilityRegistry.js";
import type { AgentToolProcessRunResult } from "../ToolRuntime/AgentToolProcessTypes.js";
import { toolProcessFailureResult, toolProcessSuccessResult } from "../ToolRuntime/AgentToolProcessEnvelope.js";
import { AgentExecutionErrorCodes, AgentToolProcessErrorPhases } from "../Xml/AgentXmlStatus.js";
import { throwIfAborted } from "../Core/AgentCancellation.js";
import { resolveArtifactsConfig } from "../AgentDefaults.js";
import { assertInsideRoot, parseAgentArtifactUri } from "../Artifacts/AgentArtifactLocator.js";
import { SeneraWorkspaceBoundary } from "../Execution/SeneraWorkspaceBoundary.js";
import { AgentResourceAccessIntents } from "../Safety/AgentResourceAccessPolicy.js";
import { AgentArtifactManifestIndexCache } from "./AgentArtifactManifestIndexCache.js";
import { AgentArtifactMemoryContentCacheRegistry } from "./AgentArtifactMemoryContentCacheRegistry.js";
import {
  ArtifactMemoryReadRequestLimitError,
  assertArtifactMemoryReadRequestWithinLimits,
  readArtifactMemories,
} from "./AgentArtifactMemoryReader.js";
import { type ArtifactMemoryReadArguments, ArtifactMemoryReadArgumentsSchema } from "./AgentArtifactMemoryTypes.js";

const ArtifactManifestIndexes = new AgentArtifactManifestIndexCache();
const ArtifactMemoryContentCaches = new AgentArtifactMemoryContentCacheRegistry();

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
    const artifactsConfig = resolveArtifactsConfig(context.config);
    assertArtifactMemoryReadRequestWithinLimits(parsed.data, {
      maxArtifacts: artifactsConfig.MemoryReadMaxArtifacts,
      maxRefs: artifactsConfig.MemoryReadMaxRefs,
    });
    const artifactRoot = await resolveArtifactRoot(context.workspaceRoot, artifactsConfig.RootDir);
    const manifests = await ArtifactManifestIndexes.load({
      artifactRoot,
      workspaceRoot: context.workspaceRoot,
      requiredArtifactIds: parsed.data.artifactUris.flatMap((uri) => parseAgentArtifactUri(uri) ?? []),
    });
    throwIfAborted(context.signal);
    const result = await readArtifactMemories(parsed.data, manifests, {
      workspaceRoot: context.workspaceRoot,
      artifactRoot,
      maxBytes: resolveArtifactReadMaxBytes(parsed.data, artifactsConfig.TextFileMaxBytes),
      startByte: parsed.data.startBytePerRef ?? 0,
      structuredJsonMaxBytes: artifactsConfig.MemoryReadStructuredJsonMaxBytes,
      maxArtifacts: artifactsConfig.MemoryReadMaxArtifacts,
      maxRefs: artifactsConfig.MemoryReadMaxRefs,
      maxConcurrency: artifactsConfig.MemoryReadMaxConcurrency,
      ranges: new Map(
        (parsed.data.refRanges ?? []).map((range) => [
          range.ref,
          {
            maxBytes: Math.min(range.maxBytes, artifactsConfig.TextFileMaxBytes),
            startByte: range.startByte ?? 0,
          },
        ]),
      ),
      contentCache: ArtifactMemoryContentCaches.get(context.workspaceRoot, {
        maxBytes: artifactsConfig.MemoryReadCacheMaxBytes,
        maxEntries: artifactsConfig.MemoryReadCacheMaxEntries,
      }),
      signal: context.signal,
    });
    return toolProcessSuccessResult(result);
  } catch (error) {
    if (error instanceof ArtifactMemoryReadRequestLimitError) {
      return artifactMemoryFailure({
        code: AgentExecutionErrorCodes.InvalidToolArguments,
        message: error.message,
        details: {
          phase: AgentToolProcessErrorPhases.RuntimeExecution,
          toolName: context.tool.name,
        },
        diagnostics: [
          {
            message: error.message,
            pointer: `/${error.argumentPath}`,
            path: [error.argumentPath],
          },
        ],
      });
    }
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

async function resolveArtifactRoot(workspaceRoot: string, rootDir: string): Promise<string> {
  const lexicalRoot = assertInsideRoot(
    workspaceRoot,
    path.resolve(workspaceRoot, rootDir),
    `artifact 根目录超出工作区：${rootDir}`,
  );
  const resolved = await new SeneraWorkspaceBoundary({ workspaceRoot, linkPolicy: "deny" }).resolve(
    lexicalRoot,
    AgentResourceAccessIntents.Read,
  );
  return resolved.absolutePath;
}

function resolveArtifactReadMaxBytes(args: ArtifactMemoryReadArguments, textFileMaxBytes: number): number {
  return Math.min(args.maxBytesPerRef ?? textFileMaxBytes, textFileMaxBytes);
}

function artifactMemoryFailure(
  error: NonNullable<AgentToolProcessRunResult["response"]["error"]>,
): AgentToolProcessRunResult {
  return toolProcessFailureResult(error);
}
