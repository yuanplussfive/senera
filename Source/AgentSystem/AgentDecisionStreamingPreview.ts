import type { RegisteredDecisionAction } from "./Types.js";
import type { AgentXmlProtocolPolicy } from "./AgentXmlPolicy.js";
import { readXmlRootName } from "./AgentXmlRootReader.js";

export type DecisionStreamingPreviewKind =
  | "final_answer"
  | "tool_calls"
  | "unknown";

export interface DecisionStreamingPreview {
  kind: DecisionStreamingPreviewKind;
  text: string;
}

export interface DecisionStreamingPreviewRule {
  root: string;
  kind: Exclude<DecisionStreamingPreviewKind, "unknown">;
}

const DEFAULT_DECISION_STREAMING_PREVIEW_RULES: readonly DecisionStreamingPreviewRule[] = [
  { root: "tool_calls", kind: "tool_calls" },
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
    return { kind: "unknown", text: "" };
  }

  const root = readXmlRootName(text)?.toLowerCase();
  if (!root) {
    return { kind: "final_answer", text };
  }

  const rule = rules.find((item) => item.root.toLowerCase() === root);
  return rule
    ? { kind: rule.kind, text: "" }
    : { kind: "final_answer", text };
}
