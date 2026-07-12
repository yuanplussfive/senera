import parseJson from "json-parse-even-better-errors";
import type { AgentToolProcessError, AgentToolProcessResponse } from "../Types/ToolRuntimeTypes.js";
import { AgentExecutionErrorCodes, AgentToolProcessErrorPhases } from "../Xml/AgentXmlStatus.js";
import { AgentToolProcessResponseEnvelope, validateToolProcessResponseEnvelope } from "./AgentToolProcessEnvelope.js";
import { failedToolProcessResponse } from "./AgentToolProcessResultFactory.js";
import type { AgentToolProcessResponseParseContext } from "./AgentToolProcessTypes.js";
import { agentErrorMessage } from "../I18n/AgentMessageCatalog.js";

export class AgentToolProcessResponseParser {
  parse(context: AgentToolProcessResponseParseContext): AgentToolProcessResponse {
    const lastLine = readLastStdoutLine(context.stdout);
    if (!lastLine) {
      return this.failure({
        code: AgentExecutionErrorCodes.ToolProcessResponseMissing,
        message: agentErrorMessage("toolProcess.structuredStdoutMissing", {
          modulePath: context.modulePath,
        }),
        details: {
          phase: AgentToolProcessErrorPhases.ResponseParsing,
          modulePath: context.modulePath,
          exitCode: context.exitCode,
          signal: context.signal,
        },
        diagnostics: [
          {
            message: agentErrorMessage("toolProcess.lastJsonLineMissing"),
            pointer: "/",
            path: [],
            suggestion: agentErrorMessage("toolProcess.lastJsonLineMissingSuggestion"),
          },
        ],
      });
    }

    const response = this.parseJsonResponse(lastLine, context);
    if (!response.ok) {
      return response.value;
    }

    return this.validateEnvelope(response.value, context);
  }

  private parseJsonResponse(
    lastLine: string,
    context: AgentToolProcessResponseParseContext,
  ): { ok: true; value: unknown } | { ok: false; value: AgentToolProcessResponse } {
    try {
      return {
        ok: true,
        value: parseJson(lastLine),
      };
    } catch (error) {
      return {
        ok: false,
        value: this.failure({
          code: AgentExecutionErrorCodes.ToolProcessResponseInvalid,
          message: agentErrorMessage("toolProcess.responseInvalidJson", {
            modulePath: context.modulePath,
          }),
          details: {
            phase: AgentToolProcessErrorPhases.ResponseParsing,
            modulePath: context.modulePath,
            receivedLine: lastLine,
            parseError: error instanceof Error ? error.message : String(error),
            exitCode: context.exitCode,
            signal: context.signal,
          },
          diagnostics: [
            {
              message: agentErrorMessage("toolProcess.lastJsonLineInvalid"),
              pointer: "/",
              path: [],
              suggestion: agentErrorMessage("toolProcess.lastJsonLineInvalidSuggestion"),
            },
          ],
        }),
      };
    }
  }

  private validateEnvelope(response: unknown, context: AgentToolProcessResponseParseContext): AgentToolProcessResponse {
    const envelope = validateToolProcessResponseEnvelope(response);
    if (envelope.ok) {
      return envelope.response;
    }

    return this.failure({
      code: AgentExecutionErrorCodes.ToolProcessResponseEnvelopeInvalid,
      message: agentErrorMessage("toolProcess.responseEnvelopeInvalid", {
        modulePath: context.modulePath,
      }),
      details: {
        phase: AgentToolProcessErrorPhases.ResponseValidation,
        modulePath: context.modulePath,
        type: readEnvelopeField(response, "type"),
        version: readEnvelopeField(response, "version"),
        expectedType: AgentToolProcessResponseEnvelope.Type,
        expectedVersion: AgentToolProcessResponseEnvelope.Version,
        issues: envelope.issues,
        exitCode: context.exitCode,
        signal: context.signal,
      },
      diagnostics: envelope.issues.map((issue) => ({
        message: issue.message,
        pointer: issue.pointer,
        path:
          issue.pointer === "/"
            ? []
            : issue.pointer
                .slice(1)
                .split("/")
                .map((part) => part.replace(/~1/g, "/").replace(/~0/g, "~")),
        suggestion: agentErrorMessage("toolProcess.responseEnvelopeSuggestion"),
      })),
    });
  }

  private failure(error: AgentToolProcessError): AgentToolProcessResponse {
    return failedToolProcessResponse(error);
  }
}

function readLastStdoutLine(stdout: string): string | undefined {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1);
}

function readEnvelopeField(value: unknown, field: "type" | "version"): unknown {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)[field]
    : undefined;
}
