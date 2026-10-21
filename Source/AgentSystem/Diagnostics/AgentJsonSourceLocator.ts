import fs from "node:fs";
import jsonSourceMap, { type JsonSourceLocation } from "json-source-map";
import { AgentSourceDiagnosticBuilder, type AgentSourceDiagnostic } from "./AgentSourceDiagnostic.js";

type JsonSourcePointers = Readonly<Record<string, { key?: JsonSourceLocation; value?: JsonSourceLocation }>>;

export class AgentJsonSourceLocator {
  private readonly builder: AgentSourceDiagnosticBuilder;

  constructor(
    source: string,
    private readonly pointers: JsonSourcePointers,
  ) {
    this.builder = new AgentSourceDiagnosticBuilder(source);
  }

  locate(pointer: string, message: string): Pick<AgentSourceDiagnostic, "position" | "frame"> {
    const sourceLocation = this.findSourceLocation(pointer);
    if (!sourceLocation) return {};
    const position = this.builder.fromLineColumn(message, sourceLocation.line + 1, sourceLocation.column + 1);
    return { position: position.position, frame: position.frame };
  }

  private findSourceLocation(pointer: string): JsonSourceLocation | undefined {
    let candidate = pointer;
    while (candidate) {
      const location = this.pointers[candidate]?.value ?? this.pointers[candidate]?.key;
      if (location) return location;
      candidate = candidate.slice(0, candidate.lastIndexOf("/"));
    }
    return this.pointers[""]?.value;
  }
}

export function locateAgentJsonFilePointer(
  filePath: string,
  pointer: string,
  message: string,
): Pick<AgentSourceDiagnostic, "position" | "frame"> {
  try {
    const source = fs.readFileSync(filePath, "utf8");
    const mapped = jsonSourceMap.parse(source);
    return new AgentJsonSourceLocator(source, mapped.pointers).locate(pointer, message);
  } catch {
    return {};
  }
}
