import {
  matchesSomeTextRule,
  type AgentTextPredicate,
} from "../AgentTextMatcher.js";

export type AgentXmlValidationMessageKind =
  | "incomplete"
  | "orphan_closing_tag"
  | "other";

interface AgentXmlValidationMessageRule {
  code: string;
  classifyAs: Exclude<AgentXmlValidationMessageKind, "other">;
  predicates: readonly AgentTextPredicate[];
}

const AgentXmlValidationMessageRules = [
  {
    code: "InvalidTag",
    classifyAs: "incomplete",
    predicates: [
      { kind: "starts_with", value: "Unclosed tag '" },
      { kind: "includes", value: "doesn't have proper closing" },
    ],
  },
  {
    code: "InvalidAttr",
    classifyAs: "incomplete",
    predicates: [{ kind: "includes", value: "open quote" }],
  },
  {
    code: "InvalidXml",
    classifyAs: "incomplete",
    predicates: [{ kind: "starts_with", value: "Invalid '[" }],
  },
  {
    code: "InvalidTag",
    classifyAs: "orphan_closing_tag",
    predicates: [{ kind: "includes", value: "has not been opened" }],
  },
] as const satisfies readonly AgentXmlValidationMessageRule[];

function matchXmlValidationMessageRule(
  error: { code: string; msg: string },
): AgentXmlValidationMessageRule | undefined {
  return AgentXmlValidationMessageRules.find(
    (rule) =>
      rule.code === error.code &&
      matchesSomeTextRule(error.msg, rule.predicates),
  );
}

export function classifyXmlValidationMessage(
  error: { code: string; msg: string },
): AgentXmlValidationMessageKind {
  return matchXmlValidationMessageRule(error)?.classifyAs ?? "other";
}

export function isIncompleteXmlValidationMessage(
  error: { code: string; msg: string },
): boolean {
  return classifyXmlValidationMessage(error) === "incomplete";
}
