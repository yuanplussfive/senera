import type { AgentHostToolHandler } from "../ToolRuntime/AgentToolHostCapabilityRegistry.js";
import type { AgentToolProcessRunResult } from "../ToolRuntime/AgentToolProcessTypes.js";
import { toolProcessFailureResult, toolProcessSuccessResult } from "../ToolRuntime/AgentToolProcessEnvelope.js";
import { AgentExecutionErrorCodes, AgentToolProcessErrorPhases } from "../Xml/AgentXmlStatus.js";
import { throwIfAborted } from "../Core/AgentCancellation.js";
import { ArtifactMemoryReadRequestLimitError } from "./AgentArtifactMemoryReader.js";
import { ArtifactMemoryReadArgumentsSchema } from "./AgentArtifactMemoryTypes.js";
import { errorMessage } from "../Core/AgentErrors.js";
import { readAgentArtifactMemoryContent } from "./AgentArtifactMemoryService.js";

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
    const result = await readAgentArtifactMemoryContent(parsed.data, context);
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
            pointer: "/artifactUris",
            path: ["artifactUris"],
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
