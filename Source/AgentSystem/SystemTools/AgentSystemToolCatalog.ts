import { errorMessage } from "../Core/AgentErrors.js";
import { isAgentUnknownRecord as isRecord } from "../Core/AgentUnknownValue.js";
import type { AgentSourceDiagnostic } from "../Diagnostics/AgentSourceDiagnostic.js";
import type {
  AgentHostToolHandler,
  AgentToolHostCapabilityRegistry,
} from "../ToolRuntime/AgentToolHostCapabilityRegistry.js";
import { toolProcessFailureResult, toolProcessSuccessResult } from "../ToolRuntime/AgentToolProcessEnvelope.js";
import { AgentExecutionErrorCodes, AgentToolProcessErrorPhases } from "../Xml/AgentXmlStatus.js";
import type { AgentSystemToolDefinition } from "./AgentSystemToolDefinition.js";

export function registerAgentSystemToolHandlers(
  registry: AgentToolHostCapabilityRegistry,
  definitions: readonly AgentSystemToolDefinition[],
): void {
  for (const definition of definitions) {
    registry.register(systemToolCapability(definition), createSystemToolHandler(definition));
  }
}

export function systemToolCapability(definition: AgentSystemToolDefinition): string {
  return `system.tool.${definition.extension.name}.${definition.name}`;
}

function createSystemToolHandler(definition: AgentSystemToolDefinition): AgentHostToolHandler {
  return async (args, context) => {
    const { resources, ...invocationArguments } = args;
    const input = definition.input.safeParse(invocationArguments);
    if (!input.success) {
      return toolProcessFailureResult({
        code: AgentExecutionErrorCodes.InvalidToolArguments,
        message: `Invalid arguments for ${definition.name}.`,
        diagnostics: input.error.issues.map((issue) => ({
          message: issue.message,
          path: issue.path.map(String),
          pointer: issue.path.length > 0 ? `/${issue.path.map(escapePointerToken).join("/")}` : "",
        })),
        details: {
          phase: AgentToolProcessErrorPhases.RuntimeExecution,
          toolName: definition.name,
          issues: input.error.issues,
        },
      });
    }

    try {
      const output = await definition.execute(input.data, {
        ...context,
        ...(isRecord(resources) ? { resources } : {}),
      });
      const parsedOutput = definition.output.safeParse(output);
      if (!parsedOutput.success) {
        return toolProcessFailureResult({
          code: AgentExecutionErrorCodes.ToolExecutionError,
          message: `${definition.name} returned an invalid result.`,
          details: {
            phase: AgentToolProcessErrorPhases.RuntimeExecution,
            toolName: definition.name,
            issues: parsedOutput.error.issues,
          },
        });
      }
      return toolProcessSuccessResult(parsedOutput.data);
    } catch (error) {
      const diagnostics = errorDiagnostics(error);
      return toolProcessFailureResult({
        code: AgentExecutionErrorCodes.ToolExecutionError,
        message: errorMessage(error),
        details: {
          phase: AgentToolProcessErrorPhases.RuntimeExecution,
          toolName: definition.name,
          ...(diagnostics.length > 0 ? { diagnostics } : {}),
        },
        ...(diagnostics.length > 0 ? { diagnostics } : {}),
      });
    }
  };
}

function errorDiagnostics(error: unknown): AgentSourceDiagnostic[] {
  if (!isRecord(error) || !Array.isArray(error.diagnostics)) return [];
  return error.diagnostics.filter(isSourceDiagnostic);
}

function isSourceDiagnostic(value: unknown): value is AgentSourceDiagnostic {
  return isRecord(value) && typeof value.message === "string";
}

function escapePointerToken(value: PropertyKey): string {
  return String(value).replaceAll("~", "~0").replaceAll("/", "~1");
}
