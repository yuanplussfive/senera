import fs from "node:fs";
import { parseMarkdownSections, type AgentMarkdownDocument } from "./AgentMarkdownSections.js";

export class AgentPromptDocumentationReader {
  readMarkdownSections(filePath: string | undefined): AgentMarkdownDocument {
    return filePath
      ? parseMarkdownSections(fs.readFileSync(filePath, "utf8"))
      : { sections: new Map<string, string>() };
  }

  readMarkdownFile(filePath: string): string {
    return fs.readFileSync(filePath, "utf8");
  }

  readOptionalMarkdownFile(filePath: string | undefined): string {
    return filePath ? this.readMarkdownFile(filePath) : "";
  }
}
