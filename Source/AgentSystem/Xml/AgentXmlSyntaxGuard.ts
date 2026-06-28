import { SaxesParser } from "saxes";
import { AgentSourceDiagnosticBuilder } from "../Diagnostics/AgentSourceDiagnostic.js";
import type { AgentXmlProtocolPolicy } from "./AgentXmlPolicy.js";
import { AgentXmlErrorCodes } from "./AgentXmlStatus.js";
import {
  AgentXmlParseError,
} from "./AgentXmlParserTypes.js";
import { AgentXmlSourceHelper } from "./AgentXmlSourceHelper.js";
import { AgentXmlCdataSectionScanner } from "./AgentXmlCdataSectionScanner.js";

export class AgentXmlSyntaxGuard {
  private readonly cdataScanner = new AgentXmlCdataSectionScanner();

  constructor(private readonly policy?: AgentXmlProtocolPolicy) {}

  assertSafe(xmlText: string, sourceHelper: AgentXmlSourceHelper): void {
    this.assertClosedCdataSections(xmlText, sourceHelper);

    const parser = new SaxesParser({
      xmlns: false,
      fragment: false,
      position: true,
    });
    const forbidden = new Map(
      (this.policy?.forbiddenSyntaxRules ?? []).map((rule) => [rule.label, rule]),
    );

    let failure: AgentXmlParseError | undefined;
    const failForbidden = (label: string) => {
      if (failure) {
        return;
      }

      const position = Math.max(0, parser.position);
      failure = new AgentXmlParseError(`XML 使用了禁止语法：${label}。`, [
        new AgentSourceDiagnosticBuilder(xmlText).fromPosition(
          `XML 使用了禁止语法：${label}。`,
          position,
          {
            suggestion: "删除 DOCTYPE、ENTITY、namespace 或处理指令；参数文本中的特殊字符请保持为普通文本或使用 XML 实体转义。",
          },
        ),
      ], AgentXmlErrorCodes.ForbiddenXmlSyntax, {
        syntax: label,
      });
    };

    parser.on("doctype", () => failForbidden(forbidden.get("DOCTYPE")?.label ?? "DOCTYPE"));
    parser.on("processinginstruction", () =>
      failForbidden(forbidden.get("processing instruction")?.label ?? "processing instruction"));
    parser.on("opentagstart", (tag) => {
      if (String(tag.name).includes(":")) {
        failForbidden(forbidden.get("namespace")?.label ?? "namespace");
      }
    });
    parser.on("attribute", (attribute) => {
      if (String(attribute.name).startsWith("xmlns")) {
        failForbidden(forbidden.get("namespace")?.label ?? "namespace");
      }
    });
    parser.on("error", (error) => {
      if (failure) {
        return;
      }

      failure = this.syntaxError(error, sourceHelper, parser);
    });

    parser.write(xmlText).close();
    if (failure) {
      throw failure;
    }
  }

  private assertClosedCdataSections(
    xmlText: string,
    sourceHelper: AgentXmlSourceHelper,
  ): void {
    const result = this.cdataScanner.scan(xmlText);
    if (result.ok) {
      return;
    }

    const position = sourceHelper.positionFromOffset(result.startOffset);
    throw new AgentXmlParseError("XML 中存在未闭合的 CDATA。", [
      sourceHelper.diagnosticForOffset(
        "XML 中存在未闭合的 CDATA。",
        result.startOffset,
        "修正字段正文和外层标签闭合；不要把文本片段插入标签名、开始标签或结束标签中。",
        {
          pointer: "/",
        },
      ),
    ], AgentXmlErrorCodes.InvalidXmlSyntax, {
      pointer: "/",
      line: position.line,
      column: position.column,
      reason: "unclosed_cdata",
    });
  }

  private syntaxError(
    error: Error,
    sourceHelper: AgentXmlSourceHelper,
    parser: SaxesParser,
  ): AgentXmlParseError {
    const message = error.message.includes("unclosed cdata")
      ? "XML 中存在未闭合的 CDATA。"
      : `XML 格式无效：${error.message}`;
    const reason = error.message.includes("unclosed cdata")
      ? "unclosed_cdata"
      : "saxes_error";
    const position = Math.max(0, parser.position);
    const sourcePosition = sourceHelper.positionFromOffset(position);

    return new AgentXmlParseError(message, [
      sourceHelper.diagnosticForOffset(
        message,
        position,
        reason === "unclosed_cdata"
          ? "修正字段正文和外层标签闭合；不要把文本片段插入标签名、开始标签或结束标签中。"
          : "修复 XML 标签闭合、嵌套或非法字符。",
        {
          pointer: "/",
        },
      ),
    ], AgentXmlErrorCodes.InvalidXmlSyntax, {
      pointer: "/",
      line: sourcePosition.line,
      column: sourcePosition.column,
      reason,
    });
  }
}
