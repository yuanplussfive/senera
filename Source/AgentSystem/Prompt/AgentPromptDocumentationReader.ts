import fs from "node:fs";
import {
  parseMarkdownSections,
  type AgentMarkdownDocument,
} from "../Xml/AgentMarkdownSections.js";
import { AgentMarkdownPromptXmlRenderer } from "../Xml/AgentMarkdownPromptXmlRenderer.js";

export class AgentPromptDocumentationReader {
  constructor(
    private readonly markdownRenderer: AgentMarkdownPromptXmlRenderer,
  ) {}

  readMarkdownSections(filePath: string | undefined): AgentMarkdownDocument {
    return filePath
      ? parseMarkdownSections(fs.readFileSync(filePath, "utf8"))
      : { sections: new Map<string, string>() };
  }

  renderMarkdownFile(filePath: string): string {
    return this.markdownRenderer.renderOrThrow(
      fs.readFileSync(filePath, "utf8"),
      filePath,
    );
  }

  renderOptionalMarkdownFile(filePath: string | undefined): string {
    return filePath ? this.renderMarkdownFile(filePath) : "";
  }
}
