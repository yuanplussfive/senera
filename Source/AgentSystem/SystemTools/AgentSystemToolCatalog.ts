import { errorMessage } from "../Core/AgentErrors.js";
import { isAgentUnknownRecord as isRecord } from "../Core/AgentUnknownValue.js";
import type { AgentSourceDiagnostic } from "../Diagnostics/AgentSourceDiagnostic.js";
import type {
  AgentHostToolHandler,
  AgentToolHostCapabilityRegistry,
} from "../ToolRuntime/AgentToolHostCapabilityRegistry.js";
import { toolProcessFailureResult, toolProcessSuccessResult } from "../ToolRuntime/AgentToolProcessEnvelope.js";
import {
  AgentExecutionErrorCodes,
  AgentToolProcessErrorPhases,
  isAgentExecutionErrorCode,
} from "../Xml/AgentXmlStatus.js";
import { isSystemToolExecutionResult, type AgentSystemToolDefinition } from "./AgentSystemToolDefinition.js";

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
    const executionContext = {
      ...context,
      ...(isRecord(resources) ? { resources } : {}),
    };
    const input = definition.input.safeParse(invocationArguments);
    if (!input.success) {
      const projected = await definition.projectInvalidInput?.(invocationArguments, input.error, executionContext);
      if (projected) return toolProcessFailureResult(projected);
      const diagnostics = input.error.issues.map((issue) => ({
        code: issue.code,
        message: issue.message,
        path: issue.path.map(String),
        pointer: issue.path.length > 0 ? `/${issue.path.map(escapePointerToken).join("/")}` : "",
      }));
      return toolProcessFailureResult({
        code: AgentExecutionErrorCodes.InvalidToolArguments,
        message: `Invalid arguments for ${definition.name}.`,
        diagnostics,
        details: {
          phase: AgentToolProcessErrorPhases.RuntimeExecution,
          toolName: definition.name,
          issues: diagnostics,
        },
      });
    }

    try {
      const executed = definition.executeWithArtifacts
        ? await definition.executeWithArtifacts(input.data, executionContext)
        : await definition.execute(input.data, executionContext);
      const output = isSystemToolExecutionResult(executed) ? executed.result : executed;
      const process = isSystemToolExecutionResult(executed) ? executed.process : undefined;
      const parsedOutput = definition.output.safeParse(output);
      if (!parsedOutput.success) {
        const diagnostics = parsedOutput.error.issues.map((issue) => ({
          code: issue.code,
          path: issue.path.map(String),
          message: issue.message,
        }));
        return withSystemToolProcess(
          toolProcessFailureResult({
            code: AgentExecutionErrorCodes.ToolExecutionError,
            message: `${definition.name} returned an invalid result.`,
            diagnostics,
            details: {
              phase: AgentToolProcessErrorPhases.RuntimeExecution,
              toolName: definition.name,
              issues: diagnostics,
            },
          }),
          process,
        );
      }
      if (isSystemToolExecutionResult(executed) && executed.failure) {
        return withSystemToolProcess(
          {
            ...toolProcessFailureResult(executed.failure),
            ...(executed.artifactPayload ? { artifactPayload: executed.artifactPayload } : {}),
          },
          process,
        );
      }
      return withSystemToolProcess(
        toolProcessSuccessResult(parsedOutput.data, {
          ...(isSystemToolExecutionResult(executed) && executed.artifactPayload
            ? { artifactPayload: executed.artifactPayload }
            : {}),
        }),
        process,
      );
    } catch (error) {
      const diagnostics = errorDiagnostics(error);
      return toolProcessFailureResult({
        code: executionErrorCode(error),
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

function withSystemToolProcess(
  result: ReturnType<typeof toolProcessSuccessResult> | ReturnType<typeof toolProcessFailureResult>,
  process: import("./AgentSystemToolDefinition.js").AgentSystemToolExecutionProcess | undefined,
) {
  return {
    ...result,
    ...(process?.stdout === undefined ? {} : { stdout: process.stdout }),
    ...(process?.stderr === undefined ? {} : { stderr: process.stderr }),
    ...(process?.exitCode === undefined ? {} : { exitCode: process.exitCode }),
    ...(process?.signal === undefined ? {} : { signal: process.signal }),
  };
}

function executionErrorCode(error: unknown) {
  return isRecord(error) && isAgentExecutionErrorCode(error.code)
    ? error.code
    : AgentExecutionErrorCodes.ToolExecutionError;
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
