import type {
  AgentHostToolHandler,
  AgentHostToolContractProjection,
} from "../ToolRuntime/AgentToolHostCapabilityRegistry.js";
import type { AgentToolProcessRunResult } from "../ToolRuntime/AgentToolProcessTypes.js";
import { toolProcessFailureResult, toolProcessSuccessResult } from "../ToolRuntime/AgentToolProcessEnvelope.js";
import { AgentExecutionErrorCodes, AgentToolProcessErrorPhases } from "../Xml/AgentXmlStatus.js";
import { throwIfAborted } from "../Core/AgentCancellation.js";
import { ArtifactMemoryReadRequestLimitError } from "./AgentArtifactMemoryReader.js";
import type { ArtifactMemoryReadArguments } from "./AgentArtifactMemoryTypes.js";
import { errorMessage } from "../Core/AgentErrors.js";
import { readAgentArtifactMemoryContent } from "./AgentArtifactMemoryService.js";
import { systemToolArguments } from "../SystemTools/AgentSystemToolDefinition.js";

/** Old recorded calls remain executable; new model requests see only field selection. */
export const ArtifactReadReplayContract: AgentHostToolContractProjection = {
  projectRuntimeValidationSchema(_tool, schema) {
    return {
      anyOf: [
        schema,
        {
          type: "object",
          properties: {
            artifactUris: { type: "array", minItems: 1, items: { type: "string", minLength: 1 } },
            view: { type: "string", enum: ["compact", "full"] },
          },
          required: ["artifactUris", "view"],
          additionalProperties: false,
        },
      ],
    };
  },
};

export const readArtifactMemoryHostTool: AgentHostToolHandler = async (args, context) => {
  const input = systemToolArguments<ArtifactMemoryReadArguments>(args);

  try {
    throwIfAborted(context.signal);
    const result = await readAgentArtifactMemoryContent(input, context);
    return toolProcessSuccessResult(result);
  } catch (error) {
    throwIfAborted(context.signal);
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
            pointer: "/requests",
            path: ["requests"],
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

function artifactMemoryFailure(
  error: NonNullable<AgentToolProcessRunResult["response"]["error"]>,
): AgentToolProcessRunResult {
  return toolProcessFailureResult(error);
}
