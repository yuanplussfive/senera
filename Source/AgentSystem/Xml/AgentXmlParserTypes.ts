import type { AgentSourceDiagnostic } from "../Diagnostics/AgentSourceDiagnostic.js";
import type { AgentTextBudgetEvaluator } from "../Text/AgentTextBudget.js";
import type { AgentXmlProtocolPolicy } from "./AgentXmlPolicy.js";
import type { AgentXmlErrorCode } from "./AgentXmlStatus.js";
import type { AgentXmlSourceHelper } from "./AgentXmlSourceHelper.js";

export interface ParsedXmlRoot {
  rootName: string;
  value: unknown;
  source: string;
  diagnostics: AgentXmlSourceHelper;
}

export type AgentXmlParseErrorCode = AgentXmlErrorCode;

export class AgentXmlParseError extends Error {
  constructor(
    message: string,
    readonly diagnostics: AgentSourceDiagnostic[],
    readonly code: AgentXmlParseErrorCode,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export interface AgentXmlParserOptions {
  maxDepth?: number;
  maxTextLength?: number;
  arrayElementNames?: string[];
  arrayElementNameSuffix?: string;
  textBudget?: AgentTextBudgetEvaluator;
  policy?: AgentXmlProtocolPolicy;
}

export type XmlPath = Array<string | number>;
