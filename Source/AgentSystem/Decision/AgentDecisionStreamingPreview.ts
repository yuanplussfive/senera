import type { RegisteredDecisionAction } from "../Types/PluginRuntimeTypes.js";
import {
  AgentDefaultXmlProtocolSpec,
  type AgentXmlProtocolPolicy,
} from "../Xml/AgentXmlPolicy.js";
import { readXmlRootName } from "../Xml/AgentXmlRootReader.js";

export type DecisionStreamingPreviewKind =
  | "final_answer"
  | "tool_calls"
  | "unknown";

export interface DecisionStreamingPreview {
  kind: DecisionStreamingPreviewKind;
  text: string;
  preambleText: string;
}

export interface DecisionStreamingPreviewRule {
  root: string;
  kind: Exclude<DecisionStreamingPreviewKind, "unknown">;
}

const DEFAULT_DECISION_STREAMING_PREVIEW_RULES: readonly DecisionStreamingPreviewRule[] = [
  { root: AgentDefaultXmlProtocolSpec.roots.toolCalls, kind: "tool_calls" },
];

export function createDecisionStreamingPreviewRules(
  actions?: readonly Pick<RegisteredDecisionAction, "kind" | "xmlRoot">[],
): DecisionStreamingPreviewRule[] {
  if (!actions || actions.length === 0) {
    return [...DEFAULT_DECISION_STREAMING_PREVIEW_RULES];
  }

  return actions.map((action) => ({
    root: action.xmlRoot,
    kind: "tool_calls",
  }));
}

export function extractDecisionStreamingPreview(
  text: string,
  _policy?: AgentXmlProtocolPolicy,
  rules: readonly DecisionStreamingPreviewRule[] = DEFAULT_DECISION_STREAMING_PREVIEW_RULES,
): DecisionStreamingPreview {
  if (!text) {
    return { kind: "unknown", text: "", preambleText: "" };
  }

  if (!isClosedPureXml(text)) {
    return { kind: "final_answer", text, preambleText: "" };
  }

  const root = readXmlRootName(text)?.toLowerCase();
  if (!root) {
    return { kind: "final_answer", text, preambleText: "" };
  }

  const rule = rules.find((item) => item.root.toLowerCase() === root);
  return rule
    ? {
        kind: rule.kind,
        text: "",
        preambleText: "",
      }
    : { kind: "final_answer", text, preambleText: "" };
}

function isClosedPureXml(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.startsWith("<") && trimmed.endsWith(">");
}
