import { AgentRetryableError } from "../Retry/AgentRetryableError.js";
import { AgentXmlEnvelopeBoundaryScanner } from "./AgentXmlEnvelopeBoundaryScanner.js";
import { AgentXmlErrorCodes } from "./AgentXmlStatus.js";
import { AgentXmlLexicalScanner } from "./AgentXmlLexicalScanner.js";
import type { AgentXmlProtocolSpec } from "./AgentXmlPolicy.js";

export interface ForbiddenOutputXmlMatch {
  rootName: string;
  xml?: string;
  reason: "forbidden_context_tag" | "legacy_tool_root" | "unknown_xml_root";
  polluted: boolean;
}

export class AgentForbiddenOutputXmlRetryableError extends AgentRetryableError {
  constructor(
    readonly responseText: string,
    readonly match: ForbiddenOutputXmlMatch,
  ) {
    super({
      retryable: true,
      code: AgentXmlErrorCodes.ForbiddenOutputXml,
      message: buildMessage(match),
      diagnostics: [{
        message: buildMessage(match),
        pointer: `/${match.rootName}`,
        suggestion: buildSuggestion(match),
      }],
      repairPrompt: buildRepairPrompt(match),
    });
  }
}

export class AgentForbiddenOutputXmlGuard {
  private readonly scanner = new AgentXmlLexicalScanner();
  private readonly boundaryScanner = new AgentXmlEnvelopeBoundaryScanner();
  private readonly forbiddenRoots: ReadonlySet<string>;
  private readonly legacyToolRoots = new Set(["tool_calls"]);

  constructor(private readonly protocol: AgentXmlProtocolSpec) {
    this.forbiddenRoots = new Set([
      protocol.roots.contextUserMessage,
      protocol.roots.contextToolResults,
      protocol.roots.readOnlyEvidence,
      protocol.roots.currentUserMessage,
      protocol.roots.historicalUserTurn,
      protocol.roots.toolResults,
      protocol.roots.agentResult,
    ]);
  }

  inspect(text: string): ForbiddenOutputXmlMatch | undefined {
    const candidate = text.trimStart();
    const tag = this.scanner.readLeadingTag(candidate);
    if (!tag || tag.kind !== "open") {
      return undefined;
    }

    const reason = this.classifyRoot(tag.name);
    if (!reason) {
      return undefined;
    }

    const boundary = this.boundaryScanner.findFirstCompleteBoundary(candidate);
    const xml = boundary === undefined ? undefined : candidate.slice(0, boundary).trim();
    return {
      rootName: tag.name,
      xml,
      reason,
      polluted: xml !== undefined && candidate.trim() !== xml,
    };
  }

  private classifyRoot(rootName: string): ForbiddenOutputXmlMatch["reason"] | undefined {
    if (this.forbiddenRoots.has(rootName)) {
      return "forbidden_context_tag";
    }

    if (this.legacyToolRoots.has(rootName)) {
      return "legacy_tool_root";
    }

    return rootName === this.protocol.roots.toolCalls
      ? undefined
      : "unknown_xml_root";
  }
}

function buildMessage(match: ForbiddenOutputXmlMatch): string {
  return ({
    forbidden_context_tag: `模型输出了内部历史上下文标签：<${match.rootName}>。`,
    legacy_tool_root: `模型输出了旧工具调用根标签：<${match.rootName}>。`,
    unknown_xml_root: `模型输出了非当前协议允许的 XML 根标签：<${match.rootName}>。`,
  } satisfies Record<ForbiddenOutputXmlMatch["reason"], string>)[match.reason];
}

function buildSuggestion(match: ForbiddenOutputXmlMatch): string {
  return match.reason === "legacy_tool_root"
    ? "如果要调用工具，改用当前协议根 <senera_tool_calls>；如果只是回答用户，删除 XML 包装并直接自然语言回复。"
    : "删除内部上下文包装，直接用自然语言回复用户；只有真实工具调用才能输出 <senera_tool_calls>。";
}

function buildRepairPrompt(match: ForbiddenOutputXmlMatch): string {
  const heading = match.reason === "forbidden_context_tag"
    ? "上一条回复输出了内部只读上下文包装。"
    : buildMessage(match);

  return [
    heading,
    "上一条回复复制了只读历史上下文包装。那些包装只用于提供证据，绝不能作为当前回复输出。",
    "如果你是在回答用户：只输出自然语言或 Markdown，不要包任何 XML。",
    "如果你确实需要调用工具：只输出一个完整、干净的 <senera_tool_calls> XML 根标签。",
    "不要输出解释性前缀、后缀或代码围栏。",
  ].join("\n");
}
