export const AgentContinuityEntityKinds = [
  "concept",
  "person",
  "organization",
  "place",
  "time",
  "event",
  "topic",
  "artifact",
  "item",
  "preference",
  "state",
  "goal",
  "task",
  "conversation",
] as const;
export type AgentContinuityEntityKind = (typeof AgentContinuityEntityKinds)[number];

export const AgentContinuityRelationCardinalities = ["many_to_many", "single_subject"] as const;
export type AgentContinuityRelationCardinality = (typeof AgentContinuityRelationCardinalities)[number];

export const AgentContinuityRelationEvidencePolicies = ["explicit", "inferred"] as const;
export type AgentContinuityRelationEvidencePolicy = (typeof AgentContinuityRelationEvidencePolicies)[number];

export const AgentContinuityRelationMaturities = ["candidate", "active", "established"] as const;
export type AgentContinuityRelationMaturity = (typeof AgentContinuityRelationMaturities)[number];

export interface AgentContinuityRelationDefinition {
  readonly introducedInVersion: number;
  readonly id: string;
  readonly label: string;
  readonly aliases: readonly string[];
  readonly subjectKinds: readonly AgentContinuityEntityKind[];
  readonly objectKinds: readonly AgentContinuityEntityKind[];
  /** Preferred kinds are host inference hints; model output never supplies them. */
  readonly preferredSubjectKind?: AgentContinuityEntityKind;
  readonly preferredObjectKind?: AgentContinuityEntityKind;
  readonly cardinality: AgentContinuityRelationCardinality;
  readonly evidencePolicy: AgentContinuityRelationEvidencePolicy;
  readonly direction: "directed";
  readonly inverseRelationId?: string;
  readonly temporalKinds: readonly ["persistent", "instant", "interval", "until_condition", "recurring"];
  readonly recall: {
    readonly traversable: boolean;
    /** Optional relation-specific upper bound; the global recall policy is used when omitted. */
    readonly maxHops?: number;
    readonly pathWeight: number;
  };
}

const AllEntityKinds: readonly AgentContinuityEntityKind[] = AgentContinuityEntityKinds;
export const AgentContinuityRelationCatalogVersion = 2;
export const DefaultAgentContinuityGraphTraversal = Object.freeze({
  traversable: true,
  maxHops: 1,
  pathWeight: 0.86,
});

/**
 * The relation vocabulary is deliberately centralized. Model output may suggest
 * only one of these ids; persistence never accepts an unregistered edge type.
 */
export const AgentContinuityRelationCatalog: readonly AgentContinuityRelationDefinition[] = [
  defineRelation({
    id: "knows",
    label: "认识",
    aliases: ["熟悉", "knows"],
    subjectKinds: ["person"],
    objectKinds: ["person"],
    inverseRelationId: "knows",
  }),
  defineRelation({
    id: "lives_at",
    label: "居住于",
    aliases: ["住在", "居住在", "lives in", "lives_at"],
    subjectKinds: ["person", "concept"],
    objectKinds: ["place", "concept"],
    cardinality: "single_subject",
    preferredSubjectKind: "person",
    preferredObjectKind: "place",
  }),
  defineRelation({
    id: "located_at",
    label: "位于",
    aliases: ["位于", "located in"],
    subjectKinds: ["person", "event", "artifact", "item", "organization", "concept"],
    objectKinds: ["place", "concept"],
    cardinality: "single_subject",
    preferredObjectKind: "place",
  }),
  defineRelation({
    id: "owns",
    label: "拥有",
    aliases: ["持有", "owns"],
    subjectKinds: ["person", "organization"],
    objectKinds: ["artifact", "item", "place", "concept"],
  }),
  defineRelation({
    id: "member_of",
    label: "隶属于",
    aliases: ["成员", "member of"],
    subjectKinds: ["person", "organization"],
    objectKinds: ["organization"],
    cardinality: "single_subject",
    preferredSubjectKind: "person",
    preferredObjectKind: "organization",
  }),
  defineRelation({
    id: "caused_by",
    label: "由其导致",
    aliases: ["源于", "caused by"],
    subjectKinds: ["event", "state", "concept"],
    objectKinds: ["event", "state", "concept"],
    inverseRelationId: "causes",
  }),
  defineRelation({
    id: "causes",
    label: "导致",
    subjectKinds: ["event", "state", "concept"],
    objectKinds: ["event", "state", "concept"],
    inverseRelationId: "caused_by",
  }),
  defineRelation({ id: "depends_on", label: "依赖", subjectKinds: AllEntityKinds, objectKinds: AllEntityKinds }),
  defineRelation({
    introducedInVersion: 2,
    id: "contributes_to",
    label: "推进",
    aliases: ["服务于", "推进目标", "contributes to"],
    subjectKinds: ["event", "task", "goal", "concept"],
    objectKinds: ["goal", "event", "task", "concept"],
  }),
  defineRelation({
    id: "scheduled_for",
    label: "安排在",
    aliases: ["安排于", "scheduled for"],
    subjectKinds: ["event", "task", "goal", "concept"],
    objectKinds: ["time", "concept"],
    cardinality: "single_subject",
    preferredSubjectKind: "event",
    preferredObjectKind: "time",
  }),
  defineRelation({
    id: "participates_in",
    label: "参与",
    aliases: ["参加", "participates in"],
    subjectKinds: ["person", "organization"],
    objectKinds: ["event", "task", "goal", "concept"],
    preferredSubjectKind: "person",
    preferredObjectKind: "event",
  }),
  defineRelation({
    id: "plans",
    label: "计划",
    aliases: ["计划着", "plan"],
    subjectKinds: ["person", "concept", "goal"],
    objectKinds: ["event", "goal", "concept"],
  }),
  defineRelation({
    id: "prefers",
    label: "偏好",
    subjectKinds: ["person", "concept"],
    objectKinds: ["preference", "topic", "concept"],
    preferredSubjectKind: "person",
  }),
  defineRelation({
    id: "part_of",
    label: "属于",
    subjectKinds: ["event", "artifact", "item", "topic", "concept"],
    objectKinds: ["event", "artifact", "item", "topic", "concept"],
  }),
  defineRelation({
    id: "about",
    label: "关于",
    subjectKinds: ["event", "artifact", "conversation", "task", "goal", "concept"],
    objectKinds: AllEntityKinds,
  }),
  defineRelation({
    id: "blocks",
    label: "阻塞",
    subjectKinds: ["event", "goal", "task", "concept"],
    objectKinds: AllEntityKinds,
  }),
];

const RelationById = new Map(AgentContinuityRelationCatalog.map((definition) => [definition.id, definition] as const));
const RelationByAlias = new Map(
  AgentContinuityRelationCatalog.flatMap((definition) =>
    [definition.label, ...definition.aliases].map((alias) => [normalizeRelationKey(alias), definition] as const),
  ),
);

for (const definition of AgentContinuityRelationCatalog) validateRelationDefinition(definition);

export function getAgentContinuityRelationDefinition(relationId: string): AgentContinuityRelationDefinition {
  const normalized = relationId.trim();
  const definition = RelationById.get(normalized) ?? RelationByAlias.get(normalizeRelationKey(normalized));
  if (!definition) throw new Error(`Unknown continuity relation: ${relationId}`);
  return definition;
}

/**
 * Model-facing contracts use ids only. Labels and aliases remain a presentation
 * concern and must never silently widen a structured capture response.
 */
export function isAgentContinuityRelationCatalogId(value: string): boolean {
  return RelationById.has(value.trim());
}

export function resolveAgentContinuityRelationId(value: string): AgentContinuityRelationDefinition["id"] {
  return getAgentContinuityRelationDefinition(value).id;
}

export function resolveAgentContinuityRelationEndpointKinds(relationId: string): {
  readonly subjectKind: AgentContinuityEntityKind;
  readonly objectKind: AgentContinuityEntityKind;
} {
  const definition = getAgentContinuityRelationDefinition(relationId);
  return {
    subjectKind: definition.preferredSubjectKind ?? definition.subjectKinds[0]!,
    objectKind: definition.preferredObjectKind ?? definition.objectKinds[0]!,
  };
}

export function assertAgentContinuityRelationEndpoints(input: {
  readonly relationId: string;
  readonly subject: { readonly uri: string; readonly kind: AgentContinuityEntityKind };
  readonly object: { readonly uri: string; readonly kind: AgentContinuityEntityKind };
}): AgentContinuityRelationDefinition {
  const definition = getAgentContinuityRelationDefinition(input.relationId);
  if (!definition.subjectKinds.includes(input.subject.kind)) {
    throw new Error(
      `Continuity relation ${definition.id} does not accept subject kind ${input.subject.kind}: ${input.subject.uri}`,
    );
  }
  if (!definition.objectKinds.includes(input.object.kind)) {
    throw new Error(
      `Continuity relation ${definition.id} does not accept object kind ${input.object.kind}: ${input.object.uri}`,
    );
  }
  return definition;
}

export interface AgentContinuityRelationMaturityPolicy {
  readonly activeIndependentEvidence: number;
  readonly establishedIndependentEvidence: number;
}

export const AgentContinuityRelationMaturityDefaults: AgentContinuityRelationMaturityPolicy = Object.freeze({
  activeIndependentEvidence: 2,
  establishedIndependentEvidence: 3,
});

export function resolveAgentContinuityRelationMaturity(
  authority: "user_explicit" | "tool_verified" | "system_observed" | "model_inferred",
  supportCount: number,
  policy: AgentContinuityRelationMaturityPolicy = AgentContinuityRelationMaturityDefaults,
): AgentContinuityRelationMaturity {
  if (supportCount >= policy.establishedIndependentEvidence) return "established";
  if (authority !== "model_inferred" || supportCount >= policy.activeIndependentEvidence) return "active";
  return "candidate";
}

export function agentContinuityRelationMaturityRank(maturity: AgentContinuityRelationMaturity): number {
  return AgentContinuityRelationMaturities.indexOf(maturity);
}

function defineRelation(
  input: Omit<
    AgentContinuityRelationDefinition,
    "introducedInVersion" | "direction" | "temporalKinds" | "recall" | "aliases" | "cardinality" | "evidencePolicy"
  > &
    Partial<
      Pick<
        AgentContinuityRelationDefinition,
        "introducedInVersion" | "aliases" | "cardinality" | "evidencePolicy" | "inverseRelationId"
      >
    >,
): AgentContinuityRelationDefinition {
  return Object.freeze({
    ...input,
    introducedInVersion: input.introducedInVersion ?? 1,
    aliases: Object.freeze(input.aliases ?? []),
    cardinality: input.cardinality ?? "many_to_many",
    evidencePolicy: input.evidencePolicy ?? "explicit",
    direction: "directed",
    temporalKinds: ["persistent", "instant", "interval", "until_condition", "recurring"] as const,
    recall: {
      traversable: DefaultAgentContinuityGraphTraversal.traversable,
      pathWeight: DefaultAgentContinuityGraphTraversal.pathWeight,
    },
  });
}

function normalizeRelationKey(value: string): string {
  return value
    .trim()
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[\p{P}\p{S}\s]+/gu, "");
}

function validateRelationDefinition(definition: AgentContinuityRelationDefinition): void {
  if (definition.subjectKinds.length === 0 || definition.objectKinds.length === 0) {
    throw new Error(`Continuity relation ${definition.id} must declare endpoint kinds.`);
  }
  if (definition.preferredSubjectKind && !definition.subjectKinds.includes(definition.preferredSubjectKind)) {
    throw new Error(`Continuity relation ${definition.id} has an invalid preferred subject kind.`);
  }
  if (definition.preferredObjectKind && !definition.objectKinds.includes(definition.preferredObjectKind)) {
    throw new Error(`Continuity relation ${definition.id} has an invalid preferred object kind.`);
  }
  if (definition.inverseRelationId && !RelationById.has(definition.inverseRelationId)) {
    throw new Error(`Continuity relation ${definition.id} references an unknown inverse relation.`);
  }
}
