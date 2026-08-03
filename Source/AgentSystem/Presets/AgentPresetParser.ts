import path from "node:path";
import type { AgentPresetFormat, AgentParsedPresetDocument, AgentPresetFileRecord } from "./AgentPresetTypes.js";
import { parseJsonText } from "../Core/AgentJsonParsing.js";

export class AgentPresetParser {
  parse(record: AgentPresetFileRecord): AgentParsedPresetDocument {
    if (record.format === "json") {
      return {
        ...record,
        title: titleFromFileName(record.name),
        parsedJson: parseJsonText(record.content, "Preset JSON content"),
      };
    }

    return {
      ...record,
      title: titleFromFileName(record.name),
    };
  }

  validate(record: AgentPresetFileRecord): void {
    this.parse(record);
  }

  validateContent(format: AgentPresetFormat, content: string): void {
    if (format === "json") {
      parseJsonText(content, "Preset JSON content");
    }
  }
}

function titleFromFileName(fileName: string): string {
  const parsed = path.parse(fileName);
  return parsed.name.trim() || fileName;
}
