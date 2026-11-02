import type { AgentSourceDiagnostic } from "../Diagnostics/AgentSourceDiagnostic.js";
import { AgentSourceDiagnosticBuilder } from "../Diagnostics/AgentSourceDiagnostic.js";

export class AgentXmlSourceHelper {
  private readonly builder: AgentSourceDiagnosticBuilder;

  constructor(readonly source: string) {
    this.builder = new AgentSourceDiagnosticBuilder(source);
  }

  diagnosticForRoot(message: string, rootName: string, suggestion?: string, occurrence = 0): AgentSourceDiagnostic {
    const position = this.builder.findXmlTag(rootName, occurrence);
    if (!position) {
      return {
        message,
        suggestion,
      };
    }

    return this.builder.fromPosition(message, position.position, {
      pointer: `/${rootName}`,
      suggestion,
    });
  }

  diagnosticForPath(
    message: string,
    rootName: string,
    path: Array<string | number>,
    suggestion?: string,
  ): AgentSourceDiagnostic {
    const xmlPath = [rootName, ...path];
    const resolved = this.findNearestPath(xmlPath);
    const position = resolved ? this.builder.findXmlTagByPath(resolved) : undefined;
    const pointer = this.pathToPointer(xmlPath);

    if (!position) {
      return {
        message,
        path,
        pointer,
        suggestion,
      };
    }

    return this.builder.fromPosition(message, position.position, {
      path,
      pointer,
      suggestion,
    });
  }

  diagnosticFromLineColumn(message: string, line: number, column: number, suggestion?: string): AgentSourceDiagnostic {
    return this.builder.fromLineColumn(message, line, column, {
      suggestion,
    });
  }

  diagnosticForOffset(
    message: string,
    offset: number,
    suggestion?: string,
    options: {
      pointer?: string;
      path?: Array<string | number>;
    } = {},
  ): AgentSourceDiagnostic {
    return this.builder.fromPosition(message, offset, {
      pointer: options.pointer,
      path: options.path,
      suggestion,
    });
  }

  positionFromOffset(offset: number) {
    return this.builder.positionFromOffset(offset);
  }

  private pathToPointer(path: Array<string | number>): string {
    if (path.length === 0) {
      return "";
    }

    let pointer = "";

    for (const part of path) {
      if (typeof part === "number") {
        pointer += `[${part}]`;
        continue;
      }

      pointer += `/${escapePointerSegment(part)}`;
    }

    return pointer;
  }

  private findNearestPath(path: Array<string | number>): Array<string | number> | undefined {
    for (let length = path.length; length >= 1; length -= 1) {
      const candidate = path.slice(0, length);
      if (this.builder.findXmlTagByPath(candidate)) {
        return candidate;
      }
    }

    return undefined;
  }
}

function escapePointerSegment(value: string): string {
  let output = "";
  for (const char of String(value)) {
    if (char === "~") {
      output += "~0";
      continue;
    }
    if (char === "/") {
      output += "~1";
      continue;
    }
    output += char;
  }
  return output;
}
