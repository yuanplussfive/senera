import fs from "node:fs";
import path from "node:path";
import parseJson from "json-parse-even-better-errors";
import jsonSourceMap, { type JsonSourceLocation } from "json-source-map";
import { ZodError, type ZodType } from "zod";
import type { AgentSourceFrame } from "./AgentSourceDiagnostic.js";
import { AgentSourceDiagnosticBuilder } from "./AgentSourceDiagnostic.js";

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

export class AgentJsonFileError extends Error {
  constructor(
    message: string,
    readonly diagnostic: AgentJsonDiagnostic,
  ) {
    super(message);
  }
}

export class AgentJsonFileLoader {
  load<T>(filePath: string, schema: ZodType<T>): T {
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
        throw new AgentJsonFileError(`JSON 语法错误：${absolutePath}`, {
          filePath: absolutePath,
          message: parseError.message,
          location:
            typeof parseError.position === "number"
              ? this.locationFromPosition(text, parseError.position)
              : undefined,
          frame:
            typeof parseError.position === "number"
              ? sourceBuilder.fromPosition(parseError.message, parseError.position).frame
              : undefined,
        });
      }

      throw new AgentJsonFileError(`JSON 语法错误：${absolutePath}`, {
        filePath: absolutePath,
        message: "JSON 解析失败。",
      });
    }

    const result = schema.safeParse(mapped.data);
    if (!result.success) {
      const firstIssue = result.error.issues[0];
      const pointer = firstIssue ? this.zodPathToPointer(firstIssue.path) : "";
      const sourceLocation = pointer
        ? mapped.pointers[pointer]?.value ?? mapped.pointers[pointer]?.key
        : mapped.pointers[""]?.value;

      throw new AgentJsonFileError(`JSON 结构校验失败：${absolutePath}`, {
        filePath: absolutePath,
        message: this.formatZodError(result.error),
        pointer,
        location: sourceLocation ? this.fromJsonSourceLocation(sourceLocation) : undefined,
        frame: sourceLocation
          ? sourceBuilder.fromLineColumn(
              firstIssue?.message ?? "JSON 结构校验失败。",
              sourceLocation.line + 1,
              sourceLocation.column + 1,
            ).frame
          : undefined,
        issues: result.error.issues,
      });
    }

    return result.data;
  }

  private locationFromPosition(text: string, position: number): AgentJsonLocation {
    let line = 1;
    let column = 1;

    for (let index = 0; index < position && index < text.length; index += 1) {
      if (text[index] === "\n") {
        line += 1;
        column = 1;
      } else {
        column += 1;
      }
    }

    return {
      line,
      column,
      position,
    };
  }

  private fromJsonSourceLocation(location: JsonSourceLocation): AgentJsonLocation {
    return {
      line: location.line + 1,
      column: location.column + 1,
      position: location.pos,
    };
  }

  private zodPathToPointer(path: PropertyKey[]): string {
    return path.length === 0
      ? ""
      : `/${path.map((part) => String(part).replace(/~/g, "~0").replace(/\//g, "~1")).join("/")}`;
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
