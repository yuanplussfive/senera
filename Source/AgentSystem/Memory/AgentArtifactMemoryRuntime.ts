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
import {
  ArtifactMemoryReadRequestLimitError,
  assertArtifactMemoryReadRequestWithinLimits,
  readArtifactMemories,
} from "./AgentArtifactMemoryReader.js";
import { type ArtifactMemoryReadArguments, ArtifactMemoryReadArgumentsSchema } from "./AgentArtifactMemoryTypes.js";
import { errorMessage } from "../Core/AgentErrors.js";
import { AgentTokenProjector } from "../Text/AgentTokenProjection.js";
import type { AgentToolTokenBudget } from "../Text/AgentTurnTokenBudget.js";

const ArtifactManifestIndexes = new AgentArtifactManifestIndexCache();

export const readArtifactMemoryHostTool: AgentHostToolHandler = async (args, context) => {
  const parsed = ArtifactMemoryReadArgumentsSchema.safeParse(args);
  if (!parsed.success) {
    return artifactMemoryFailure({
      code: AgentExecutionErrorCodes.InvalidToolArguments,
      message: `${context.tool.name} 参数无效。`,
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
      signal: context.signal,
      ...resolveStructuredJsonReadBudget(context.tokenBudget, artifactsConfig.MemoryReadStructuredJsonMaxTokens),
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
      code: AgentExecutionErrorCodes.ToolExecutionError,
      message: errorMessage(error),
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

/**
 * Builds the structured-JSON read budget from the active turn token budget.
 *
 * Structured Artifact JSON refs (`evidence`, `delta`, `raw`, …) require a model
 * token projector and limit so the reader can page within budget. When a turn
 * budget is available we derive both from it, capping the per-request allowance
 * by the configured maximum. When no budget is available (e.g. ad-hoc host
 * invocations without a session), structured JSON refs degrade gracefully to
 * `failed` via `requireStructuredJsonBudget` while text refs still load.
 */
function resolveStructuredJsonReadBudget(
  tokenBudget: AgentToolTokenBudget | undefined,
  maxTokens: number,
): { jsonTokenProjector?: AgentTokenProjector; jsonTokenLimit?: number } {
  if (!tokenBudget) return {};
  return {
    jsonTokenProjector: new AgentTokenProjector(tokenBudget.model),
    jsonTokenLimit: tokenBudget.availableTokens(maxTokens),
  };
}

function artifactMemoryFailure(
  error: NonNullable<AgentToolProcessRunResult["response"]["error"]>,
): AgentToolProcessRunResult {
  return toolProcessFailureResult(error);
}
