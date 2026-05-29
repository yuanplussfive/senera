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
  preambleText: string;
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
    return { kind: "unknown", text: "", preambleText: "" };
  }

  const candidate = findDecisionPreviewCandidate(text, rules);
  const root = candidate
    ? readXmlRootName(candidate.xml)?.toLowerCase()
    : readXmlRootName(text)?.toLowerCase();
  if (!root) {
    return { kind: "final_answer", text, preambleText: "" };
  }

  const rule = rules.find((item) => item.root.toLowerCase() === root);
  return rule
    ? {
        kind: rule.kind,
        text: candidate?.preamble ?? "",
        preambleText: candidate?.preamble ?? "",
      }
    : { kind: "final_answer", text, preambleText: "" };
}

function findDecisionPreviewCandidate(
  text: string,
  rules: readonly DecisionStreamingPreviewRule[],
): { preamble: string; xml: string } | undefined {
  const matches = rules
    .flatMap((rule) => findRootStartOffsets(text, rule.root))
    .sort((left, right) => left - right);
  const offset = matches[0];

  return offset === undefined
    ? undefined
    : {
        preamble: text.slice(0, offset).trim(),
        xml: text.slice(offset),
      };
}

function findRootStartOffsets(text: string, root: string): number[] {
  const offsets: number[] = [];
  const pattern = new RegExp(`<\\s*${escapeRegExp(root)}(?:\\s|>|/)`, "giu");
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text))) {
    offsets.push(match.index);
  }

  return offsets;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
