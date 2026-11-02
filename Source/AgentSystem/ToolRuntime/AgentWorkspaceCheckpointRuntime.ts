import { throwIfAborted } from "../Core/AgentCancellation.js";
import { errorMessage } from "../Core/AgentErrors.js";
import { AgentWorkspaceCheckpointRestoreService } from "../Artifacts/AgentWorkspaceCheckpointRestoreService.js";
import { AgentArtifactManifestIndexCache } from "../Memory/AgentArtifactManifestIndexCache.js";
import type { AgentHostToolHandler } from "./AgentToolHostCapabilityRegistry.js";
import { toolProcessFailureResult, toolProcessSuccessResult } from "./AgentToolProcessEnvelope.js";
import type { AgentToolProcessRunResult } from "./AgentToolProcessTypes.js";
import { AgentExecutionErrorCodes, AgentToolProcessErrorPhases } from "../Xml/AgentXmlStatus.js";
import { formatAgentTimeOffsetMillisecond } from "../Time/AgentTime.js";
import { systemToolArguments } from "../SystemTools/AgentSystemToolDefinition.js";

/** Validated by the package-owned WorkspaceRestoreCheckpoint JSON Schema. */
interface WorkspaceRestoreCheckpointArguments {
  readonly artifactUri?: string;
  readonly checkpointId?: string;
  readonly currentRevision?: string;
  readonly target: "before" | "after";
}

const ManifestIndexes = new AgentArtifactManifestIndexCache();

export const restoreWorkspaceCheckpointHostTool: AgentHostToolHandler = async (args, context) => {
  const input = systemToolArguments<WorkspaceRestoreCheckpointArguments>(args);

  try {
    throwIfAborted(context.signal);
    const result = await new AgentWorkspaceCheckpointRestoreService({
      workspaceRoot: context.workspaceRoot,
      config: context.config,
      manifestIndex: ManifestIndexes,
    }).restore({
      artifactUri: input.artifactUri,
      checkpointId: input.checkpointId,
      ...(input.currentRevision ? { currentRevision: input.currentRevision } : {}),
      target: input.target,
      signal: context.signal,
    });
    return toolProcessSuccessResult({
      ...result,
      text: `Workspace checkpoint ${result.checkpoint.id} restored the ${result.target} snapshot over ${result.restoredPaths.length} path(s).`,
      artifactUri: result.artifactUri,
      checkpoint: { ...result.checkpoint, capturedAt: formatAgentTimeOffsetMillisecond(result.checkpoint.capturedAt) },
      target: result.target,
    });
  } catch (error) {
    return checkpointFailure({
      code: AgentExecutionErrorCodes.ToolExecutionError,
      message: errorMessage(error),
      details: {
        phase: AgentToolProcessErrorPhases.RuntimeExecution,
        toolName: context.tool.name,
        ...(input.artifactUri ? { artifactUri: input.artifactUri } : {}),
        ...(input.checkpointId ? { checkpointId: input.checkpointId } : {}),
      },
    });
  }
};

function checkpointFailure(
  error: NonNullable<AgentToolProcessRunResult["response"]["error"]>,
): AgentToolProcessRunResult {
  return toolProcessFailureResult(error);
}
