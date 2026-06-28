import { AgentSourceDiagnosticBuilder } from "../Diagnostics/AgentSourceDiagnostic.js";
import { AgentXmlErrorCodes } from "./AgentXmlStatus.js";
import {
  AgentXmlParseError,
  type AgentXmlParserOptions,
} from "./AgentXmlParserTypes.js";

export function assertXmlParserTextLimits(
  trimmed: string,
  options: AgentXmlParserOptions,
): void {
  if (!trimmed) {
    throw new AgentXmlParseError("XML 输出为空。", [
      {
        message: "XML 输出为空。",
        suggestion: "输出一个已注册的决策根标签。",
      },
    ], AgentXmlErrorCodes.EmptyDecisionXml);
  }

  const tokenBudget = options.textBudget?.measure(trimmed);
  if (tokenBudget?.state === "limit_reached") {
    throw new AgentXmlParseError("XML 输出超过最大 token 限制。", [
      new AgentSourceDiagnosticBuilder(trimmed).fromPosition(
        "XML 输出超过最大 token 限制。",
        0,
        {
          pointer: "/",
          suggestion: "只输出必要的 XML 决策，不要附加解释文本或冗余字段。",
        },
      ),
    ], AgentXmlErrorCodes.DecisionXmlTokenLimitExceeded, {
      model: tokenBudget.model,
      encodingName: tokenBudget.encodingName,
      resolution: tokenBudget.resolution,
      tokenCount: tokenBudget.tokenCount,
      tokenLimit: tokenBudget.tokenLimit,
      exceededTokens: tokenBudget.exceededTokens,
    });
  }

  if (options.maxTextLength !== undefined && trimmed.length > options.maxTextLength) {
    throw new AgentXmlParseError("XML 输出超过最大长度。", [
      {
        message: "XML 输出超过最大长度。",
        suggestion: "只输出必要的 XML 决策，不要附加解释文本。",
      },
    ], AgentXmlErrorCodes.DecisionXmlTooLong, {
      length: trimmed.length,
      maxLength: options.maxTextLength,
    });
  }
}
