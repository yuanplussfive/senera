import fs from "node:fs";
import path from "node:path";
import parseJson from "json-parse-even-better-errors";
import jsonSourceMap from "json-source-map";
import { type ZodError, type ZodType } from "zod";
import type { AgentSourceFrame } from "../Diagnostics/AgentSourceDiagnostic.js";
import { AgentSourceDiagnosticBuilder } from "../Diagnostics/AgentSourceDiagnostic.js";
import { agentJsonPathToPointer } from "../Diagnostics/AgentJsonPointer.js";
import { AgentJsonSourceLocator } from "../Diagnostics/AgentJsonSourceLocator.js";
import { agentErrorMessage } from "../I18n/AgentMessageCatalog.js";
import type { AgentErrorMessageKey, AgentMessageParams } from "../I18n/AgentMessageCatalog.js";
import { AgentLocalizedError } from "../I18n/AgentLocalizedError.js";

export interface AgentJsonLocation {
  line: number;
  column: number;
  position: number;
}

export interface AgentJsonDiagnostic {
  filePath: string;
  message: string;
  pointer?: string;
  location?: AgentJsonLocation;
  frame?: AgentSourceFrame;
  issues?: unknown;
}

export type AgentJsonPayloadTransform = (payload: unknown) => unknown;

export class AgentJsonFileError extends AgentLocalizedError {
  constructor(
    messageKey: AgentErrorMessageKey,
    messageParams: AgentMessageParams,
    readonly diagnostic: AgentJsonDiagnostic,
    readonly diagnostics: readonly AgentJsonDiagnostic[] = [diagnostic],
  ) {
    super(messageKey, messageParams);
  }
}

export class AgentJsonFileLoader {
  load<T>(filePath: string, schema: ZodType<T>, transform?: AgentJsonPayloadTransform): T {
    const absolutePath = path.resolve(filePath);
    const text = fs.readFileSync(absolutePath, "utf8");
    const sourceBuilder = new AgentSourceDiagnosticBuilder(text);
    let mapped: ReturnType<typeof jsonSourceMap.parse>;

    try {
      mapped = jsonSourceMap.parse(text);
    } catch {
      try {
        parseJson(text);
      } catch (error) {
        const parseError = error as Error & { position?: number };
        throw new AgentJsonFileError(
          "json.syntaxError",
          { filePath: absolutePath },
          {
            filePath: absolutePath,
            message: parseError.message,
            location:
              typeof parseError.position === "number"
                ? sourceBuilder.positionFromOffset(parseError.position)
                : undefined,
            frame:
              typeof parseError.position === "number"
                ? sourceBuilder.fromPosition(parseError.message, parseError.position).frame
                : undefined,
          },
        );
      }

      throw new AgentJsonFileError(
        "json.syntaxError",
        { filePath: absolutePath },
        {
          filePath: absolutePath,
          message: agentErrorMessage("json.parseFailed"),
        },
      );
    }

    const result = schema.safeParse(transform ? transform(mapped.data) : mapped.data);
    if (!result.success) {
      const sourceLocator = new AgentJsonSourceLocator(text, mapped.pointers);
      const diagnostics = result.error.issues.map((issue) => {
        const pointer = agentJsonPathToPointer(
          issue.path.map((part) => (typeof part === "number" ? part : String(part))),
        );
        const sourceLocation = sourceLocator.locate(pointer, issue.message);
        return {
          filePath: absolutePath,
          message: issue.message,
          pointer,
          location: sourceLocation.position,
          frame: sourceLocation.frame,
          issues: [issue],
        } satisfies AgentJsonDiagnostic;
      });
      const primary = diagnostics[0] ?? {
        filePath: absolutePath,
        message: agentErrorMessage("json.validationErrorFallback"),
      };

      throw new AgentJsonFileError(
        "json.validationError",
        { filePath: absolutePath },
        { ...primary, message: this.formatZodError(result.error), issues: result.error.issues },
        diagnostics,
      );
    }

    return result.data;
  }

  private formatZodError(error: ZodError): string {
    return error.issues
      .map((issue) => {
        const issuePath = issue.path.length > 0 ? issue.path.join(".") : "<root>";
        return `${issuePath}: ${issue.message}`;
      })
      .join("; ");
  }
}
