import { AgentTextLocator } from "../Text/AgentTextLocator.js";

export interface AgentSourcePosition {
  line: number;
  column: number;
  position: number;
}

export interface AgentSourceFrame {
  startLine: number;
  endLine: number;
  text: string;
}

export interface AgentSourceDiagnostic {
  message: string;
  pointer?: string;
  path?: Array<string | number>;
  position?: AgentSourcePosition;
  frame?: AgentSourceFrame;
  suggestion?: string;
}

export class AgentSourceDiagnosticBuilder {
  private readonly locator = new AgentTextLocator();

  constructor(private readonly source: string) {}

  fromPosition(
    message: string,
    position: number,
    options: {
      pointer?: string;
      path?: Array<string | number>;
      suggestion?: string;
      radius?: number;
    } = {},
  ): AgentSourceDiagnostic {
    const sourcePosition = this.positionFromOffset(position);

    return {
      message,
      pointer: options.pointer,
      path: options.path,
      position: sourcePosition,
      frame: this.frameAtLine(sourcePosition.line, sourcePosition.column, options.radius ?? 2),
      suggestion: options.suggestion,
    };
  }

  fromLineColumn(
    message: string,
    line: number,
    column: number,
    options: {
      pointer?: string;
      path?: Array<string | number>;
      suggestion?: string;
      radius?: number;
    } = {},
  ): AgentSourceDiagnostic {
    return {
      message,
      pointer: options.pointer,
      path: options.path,
      position: {
        line,
        column,
        position: this.offsetFromLineColumn(line, column),
      },
      frame: this.frameAtLine(line, column, options.radius ?? 2),
      suggestion: options.suggestion,
    };
  }

  findXmlTag(tagName: string, occurrence = 0, fromOffset = 0): AgentSourcePosition | undefined {
    const pattern = new RegExp(`<\\s*${this.escapeRegExp(tagName)}(?:\\s|>|/)`, "g");
    pattern.lastIndex = fromOffset;

    let current = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(this.source))) {
      if (current === occurrence) {
        return this.positionFromOffset(match.index);
      }

      current += 1;
    }

    return undefined;
  }

  findXmlTagByPath(path: Array<string | number>): AgentSourcePosition | undefined {
    let offset = 0;
    for (let index = 0; index < path.length; index += 1) {
      const tagName = path[index];
      if (typeof tagName !== "string") {
        continue;
      }

      const next = path[index + 1];
      const occurrence = typeof next === "number" ? next : 0;
      const position = this.findXmlTag(tagName, occurrence, offset);
      if (!position) {
        return undefined;
      }

      offset = position.position + 1;
    }

    return this.positionFromOffset(Math.max(0, offset - 1));
  }

  positionFromOffset(offset: number): AgentSourcePosition {
    return this.locator.positionFromOffset(this.source, offset);
  }

  offsetFromLineColumn(line: number, column: number): number {
    return this.locator.offsetFromLineColumn(this.source, line, column);
  }

  frameAtLine(line: number, column: number, radius: number): AgentSourceFrame {
    const lines = this.source.split(/\r?\n/);
    const startLine = Math.max(1, line - radius);
    const endLine = Math.min(lines.length, line + radius);
    const width = String(endLine).length;
    const output: string[] = [];

    for (let current = startLine; current <= endLine; current += 1) {
      const prefix = String(current).padStart(width, " ");
      output.push(`${prefix} | ${lines[current - 1] ?? ""}`);

      if (current === line) {
        output.push(`${" ".repeat(width)} | ${" ".repeat(Math.max(0, column - 1))}^`);
      }
    }

    return {
      startLine,
      endLine,
      text: output.join("\n"),
    };
  }

  private escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
}
