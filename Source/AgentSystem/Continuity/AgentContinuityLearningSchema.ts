import { z } from "zod";
import { parseNormalizedBamlOutput } from "../BamlClient/AgentBamlOutputNormalizer.js";
import { isAgentContinuityStateUri } from "./AgentContinuityStateIdentity.js";
import { isAgentContinuityRuleUri } from "./AgentContinuityDomain.js";
import { isAgentContinuityRelationCatalogId } from "./AgentContinuityRelationCatalog.js";

const NonEmptyText = z.string().trim().min(1);
const IsoTimestamp = z.string().datetime({ offset: true });
const Scalar = z.union([NonEmptyText, z.number().finite(), z.boolean()]);

export const AgentContinuityNamedLifetimes = ["session", "permanent"] as const;
export const AgentContinuityConditionMatches = ["all", "any", "score"] as const;

const Lifetime = z.union([z.enum(AgentContinuityNamedLifetimes), IsoTimestamp]);

const CaptureItemSchema = z
  .object({
    kind: z.enum(["fact", "profile", "agent_profile", "relation"]),
    text: NonEmptyText.optional(),
    key: NonEmptyText.optional(),
    value: Scalar.optional(),
    from: NonEmptyText.optional(),
    relation: NonEmptyText.optional(),
    to: NonEmptyText.optional(),
  })
  .strict()
  .superRefine((item, context) => {
    if (item.kind === "fact" && !item.text) issue(context, "A fact item needs text.");
    if ((item.kind === "profile" || item.kind === "agent_profile") && (!item.key || item.value === undefined)) {
      issue(context, "A profile item needs key and value.");
    }
    if (item.kind === "relation") {
      if (!item.from || !item.relation || !item.to) issue(context, "A relation item needs from, relation, and to.");
      if (item.relation && !isAgentContinuityRelationCatalogId(item.relation)) {
        issue(context, `Unknown continuity relation: ${item.relation}`);
      }
    }
  });

const FactExtractionSchema = z
  .object({
    items: z.array(CaptureItemSchema),
    agenda: z.array(
      z
        .object({
          kind: z.enum(["goal", "activity", "event", "schedule"]),
          change: z.enum(["create", "start", "progress", "finish", "cancel"]),
          actor: z.enum(["user", "resident", "system"]),
          summary: NonEmptyText,
          timeText: NonEmptyText.optional(),
          relatesTo: NonEmptyText.optional(),
        })
        .strict(),
    ),
    needsRulePass: z.boolean(),
  })
  .strict();

const StateModelSchema = z
  .object({
    kind: z.literal("state"),
    title: NonEmptyText,
    target: NonEmptyText.refine(isAgentContinuityStateUri, "target must be a supplied Senera state URI").optional(),
    value: Scalar,
    until: Lifetime,
  })
  .strict();

const AlwaysModelSchema = z
  .object({
    kind: z.literal("always"),
    title: NonEmptyText,
    target: NonEmptyText.refine(isAgentContinuityRuleUri, "target must be a supplied Senera rule URI").optional(),
    replace: z.boolean().optional(),
    effect: NonEmptyText,
    until: Lifetime,
  })
  .strict()
  .superRefine((model, context) => {
    if (model.replace && !model.target) issue(context, "replace requires target.");
  });

const ConditionalModelSchema = z
  .object({
    kind: z.enum(["conditional", "notify"]),
    title: NonEmptyText,
    target: NonEmptyText.refine(isAgentContinuityRuleUri, "target must be a supplied Senera rule URI").optional(),
    replace: z.boolean().optional(),
    when: z.record(NonEmptyText, Scalar).optional(),
    at: IsoTimestamp.optional(),
    match: z.enum(AgentContinuityConditionMatches).optional(),
    threshold: z.number().min(0).max(1).optional(),
    effect: NonEmptyText,
    until: Lifetime,
  })
  .strict()
  .superRefine((model, context) => {
    if (model.replace && !model.target) issue(context, "replace requires target.");
    const conditionCount = Object.keys(model.when ?? {}).length + Number(Boolean(model.at));
    if (conditionCount === 0) issue(context, "A conditional model needs when or at.");
    if (model.match === "score" && model.threshold === undefined) {
      issue(context, "A score model needs threshold.");
    }
    if (model.threshold !== undefined && model.match !== "score") {
      issue(context, "threshold is only valid with match=score.");
    }
  });

const RuleItemSchema = z.discriminatedUnion("kind", [StateModelSchema, AlwaysModelSchema, ConditionalModelSchema]);

const RuleExtractionSchema = z.object({ items: z.array(RuleItemSchema).min(1) }).strict();

export type ParsedAgentContinuityCaptureItem = z.infer<typeof CaptureItemSchema>;
export type ParsedAgentContinuityFactExtraction = z.infer<typeof FactExtractionSchema>;
export type ParsedAgentContinuityRuleExtraction = z.infer<typeof RuleExtractionSchema>;
export type ParsedAgentContinuityStateModel = z.infer<typeof StateModelSchema>;
export type ParsedAgentContinuityAlwaysModel = z.infer<typeof AlwaysModelSchema>;
export type ParsedAgentContinuityConditionalModel = z.infer<typeof ConditionalModelSchema>;

export function parseAgentContinuityFactExtraction(value: unknown): ParsedAgentContinuityFactExtraction {
  const parsed = parseNormalizedBamlOutput(FactExtractionSchema, value);
  return {
    ...parsed,
    items: uniqueCaptureItems(parsed.items),
    agenda: uniqueAgendaDrafts(parsed.agenda),
  };
}

export function parseAgentContinuityRuleExtraction(value: unknown): ParsedAgentContinuityRuleExtraction {
  const parsed = parseNormalizedBamlOutput(RuleExtractionSchema, value);
  return { items: uniqueRuleItems(parsed.items) };
}

export function countAgentContinuityModels(extraction: ParsedAgentContinuityRuleExtraction): number {
  return extraction.items.length;
}

function uniqueCaptureItems(items: readonly ParsedAgentContinuityCaptureItem[]): ParsedAgentContinuityCaptureItem[] {
  const unique = new Map<string, ParsedAgentContinuityCaptureItem>();
  for (const item of items) {
    const normalized = normalizeCaptureItem(item);
    const key = captureItemKey(normalized);
    if (!unique.has(key)) unique.set(key, normalized);
  }
  return [...unique.values()];
}

function normalizeCaptureItem(item: ParsedAgentContinuityCaptureItem): ParsedAgentContinuityCaptureItem {
  return {
    ...item,
    ...(item.text ? { text: normalizeText(item.text) } : {}),
    ...(item.key ? { key: normalizeText(item.key) } : {}),
    ...(item.from ? { from: normalizeText(item.from) } : {}),
    ...(item.relation ? { relation: item.relation.trim() } : {}),
    ...(item.to ? { to: normalizeText(item.to) } : {}),
  };
}

function captureItemKey(item: ParsedAgentContinuityCaptureItem): string {
  return JSON.stringify(item).normalize("NFKC").toLocaleLowerCase();
}

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/gu, " ");
}

function uniqueAgendaDrafts(
  drafts: readonly ParsedAgentContinuityFactExtraction["agenda"][number][],
): ParsedAgentContinuityFactExtraction["agenda"] {
  const unique = new Map<string, ParsedAgentContinuityFactExtraction["agenda"][number]>();
  for (const draft of drafts) {
    const normalized = {
      ...draft,
      summary: normalizeText(draft.summary),
      ...(draft.timeText ? { timeText: normalizeText(draft.timeText) } : {}),
      ...(draft.relatesTo ? { relatesTo: normalizeText(draft.relatesTo) } : {}),
    };
    const key = JSON.stringify(normalized).normalize("NFKC").toLocaleLowerCase();
    if (!unique.has(key)) unique.set(key, normalized);
  }
  return [...unique.values()];
}

function uniqueRuleItems(
  items: readonly ParsedAgentContinuityRuleExtraction["items"][number][],
): ParsedAgentContinuityRuleExtraction["items"] {
  const unique = new Map<string, ParsedAgentContinuityRuleExtraction["items"][number]>();
  for (const item of items) {
    const normalized = normalizeRuleItem(item);
    const key = JSON.stringify(normalized).normalize("NFKC").toLocaleLowerCase();
    if (!unique.has(key)) unique.set(key, normalized);
  }
  return [...unique.values()];
}

function normalizeRuleItem(
  item: ParsedAgentContinuityRuleExtraction["items"][number],
): ParsedAgentContinuityRuleExtraction["items"][number] {
  if (item.kind === "state") {
    return { ...item, title: normalizeText(item.title), ...(item.target ? { target: item.target.trim() } : {}) };
  }
  if (item.kind === "always") {
    return {
      ...item,
      title: normalizeText(item.title),
      effect: normalizeText(item.effect),
      ...(item.target ? { target: item.target.trim() } : {}),
    };
  }
  return {
    ...item,
    title: normalizeText(item.title),
    effect: normalizeText(item.effect),
    ...(item.target ? { target: item.target.trim() } : {}),
    ...(item.when
      ? {
          when: Object.fromEntries(Object.entries(item.when).map(([key, value]) => [normalizeText(key), value])),
        }
      : {}),
  };
}

function issue(context: z.RefinementCtx, message: string): void {
  context.addIssue({ code: "custom", message });
}
