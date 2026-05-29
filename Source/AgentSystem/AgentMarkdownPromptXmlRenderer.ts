import MarkdownIt from "markdown-it";
import type Token from "markdown-it/lib/token.mjs";
import { XMLValidator } from "fast-xml-parser";
import { AgentXmlCodec } from "./AgentXmlCodec.js";

export interface AgentMarkdownPromptXmlRendererOptions {
  xmlFenceLanguages?: string[];
  codeFenceLanguages?: string[];
}

export interface AgentMarkdownPromptXmlRenderResult {
  xml: string;
  diagnostics: AgentMarkdownPromptXmlDiagnostic[];
}

export interface AgentMarkdownPromptXmlDiagnostic {
  message: string;
  line?: number;
}

type ListKind = "bullet" | "ordered";

interface RenderContext {
  output: string[];
  diagnostics: AgentMarkdownPromptXmlDiagnostic[];
  listStack: ListKind[];
}

export class AgentMarkdownPromptXmlRenderer {
  private readonly markdown = new MarkdownIt({
    html: false,
    linkify: false,
    typographer: false,
  });

  private readonly codec = new AgentXmlCodec();
  private readonly xmlFenceLanguages: Set<string>;
  private readonly codeFenceLanguages: Set<string>;

  constructor(options: AgentMarkdownPromptXmlRendererOptions = {}) {
    this.xmlFenceLanguages = new Set(options.xmlFenceLanguages ?? ["xml"]);
    this.codeFenceLanguages = new Set(options.codeFenceLanguages ?? []);
  }

  render(content: string): AgentMarkdownPromptXmlRenderResult {
    const context: RenderContext = {
      output: [],
      diagnostics: [],
      listStack: [],
    };
    const tokens = this.markdown.parse(content, {});

    for (let index = 0; index < tokens.length; index += 1) {
      const token = tokens[index];
      const next = tokens[index + 1];
      const line = this.lineFromToken(token);

      switch (token.type) {
        case "heading_open": {
          this.renderHeading(context, token, next);
          index += this.skipInline(next);
          break;
        }

        case "paragraph_open": {
          this.renderParagraph(context, next);
          index += this.skipInline(next);
          break;
        }

        case "bullet_list_open":
        case "ordered_list_open": {
          const kind = token.type === "ordered_list_open" ? "ordered" : "bullet";
          context.listStack.push(kind);
          context.output.push(`<list><kind>${kind}</kind><items>`);
          break;
        }

        case "bullet_list_close":
        case "ordered_list_close": {
          context.listStack.pop();
          context.output.push("</items></list>");
          break;
        }

        case "list_item_open":
          context.output.push("<item>");
          break;

        case "list_item_close":
          context.output.push("</item>");
          break;

        case "fence":
          this.renderFence(context, token);
          break;

        case "blockquote_open":
          context.output.push("<quote>");
          break;

        case "blockquote_close":
          context.output.push("</quote>");
          break;

        case "hr":
          context.output.push("<separator></separator>");
          break;

        case "inline":
        case "heading_close":
        case "paragraph_close":
          break;

        default:
          if (!token.hidden) {
            context.diagnostics.push({
              message: `Markdown 节点暂未转换：${token.type}`,
              line,
            });
          }
          break;
      }
    }

    return {
      xml: context.output.join("\n"),
      diagnostics: context.diagnostics,
    };
  }

  renderOrThrow(content: string, sourceName: string): string {
    const result = this.render(content);
    if (result.diagnostics.length > 0) {
      const messages = result.diagnostics.map((diagnostic) => {
        const location = diagnostic.line ? `第 ${diagnostic.line} 行` : "未知行";
        return `${sourceName}: ${location}: ${diagnostic.message}`;
      });
      throw new Error(`Markdown 文档无法转换成提示词 XML：\n${messages.join("\n")}`);
    }

    return result.xml;
  }

  private renderHeading(context: RenderContext, token: Token, inline: Token | undefined): void {
    const level = Number(token.tag.replace(/^h/i, ""));
    context.output.push("<section>");
    context.output.push(`<level>${this.codec.escapeText(Number.isFinite(level) ? level : 0)}</level>`);
    context.output.push(`<title>${this.renderInline(inline)}</title>`);
    context.output.push("</section>");
  }

  private renderParagraph(context: RenderContext, inline: Token | undefined): void {
    const tagName = context.listStack.length > 0 ? "text" : "paragraph";
    context.output.push(`<${tagName}>${this.renderInline(inline)}</${tagName}>`);
  }

  private renderFence(context: RenderContext, token: Token): void {
    const language = this.normalizeFenceLanguage(token.info);
    const line = this.lineFromToken(token);

    if (this.xmlFenceLanguages.has(language)) {
      const xml = token.content.trim();
      const validation = XMLValidator.validate(xml, {
        allowBooleanAttributes: false,
      });

      if (validation !== true) {
        context.diagnostics.push({
          message: `XML 示例无效：${validation.err.msg}`,
          line: (line ?? 1) + validation.err.line - 1,
        });
        return;
      }

      context.output.push("<example>");
      context.output.push(xml);
      context.output.push("</example>");
      return;
    }

    if (language && !this.codeFenceLanguages.has(language)) {
      context.diagnostics.push({
        message: `代码块语言不在允许列表：${language}`,
        line,
      });
      return;
    }

    context.output.push("<code_block>");
    context.output.push(`<language>${this.codec.escapeText(language || "text")}</language>`);
    context.output.push(`<content>${this.codec.escapeText(token.content.trim())}</content>`);
    context.output.push("</code_block>");
  }

  private renderInline(token: Token | undefined): string {
    if (!token) {
      return "";
    }

    return (token.children ?? [])
      .map((child) => {
        switch (child.type) {
          case "text":
            return this.codec.escapeText(child.content);
          case "code_inline":
            return `<code>${this.codec.escapeText(child.content)}</code>`;
          case "softbreak":
          case "hardbreak":
            return "\n";
          case "strong_open":
            return "<strong>";
          case "strong_close":
            return "</strong>";
          case "em_open":
            return "<em>";
          case "em_close":
            return "</em>";
          default:
            return this.codec.escapeText(child.content);
        }
      })
      .join("");
  }

  private normalizeFenceLanguage(info: string): string {
    return info.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  }

  private skipInline(token: Token | undefined): number {
    return token?.type === "inline" ? 2 : 0;
  }

  private lineFromToken(token: Token): number | undefined {
    return token.map ? token.map[0] + 1 : undefined;
  }
}
