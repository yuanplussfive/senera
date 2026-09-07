import type { AgentWorldSnapshotProvider, AgentWorldTreeProjection } from "./AgentWorldTypes.js";
import { projectAgentModelPayload, projectAgentModelText } from "../Text/AgentModelPayloadProjection.js";

/** JSON-safe world state for prompt rendering. */
export interface AgentWorldPromptContext {
  readonly enabled: true;
  readonly world: AgentWorldTreeProjection["world"];
  readonly time: Omit<AgentWorldTreeProjection["time"], "instant"> & { readonly instant: string };
  readonly calendar: AgentWorldTreeProjection["calendar"];
  readonly nodes: readonly AgentWorldPromptNode[];
  readonly edges: readonly AgentWorldPromptEdge[];
  readonly timeline: AgentWorldTreeProjection["timeline"];
  readonly changedNodeIds: AgentWorldTreeProjection["changedNodeIds"];
  readonly nextSchedules: AgentWorldTreeProjection["nextSchedules"];
  readonly commitments: AgentWorldTreeProjection["commitments"];
  readonly resident: AgentWorldTreeProjection["resident"];
}

export interface AgentWorldPromptEdge {
  readonly id: string;
  readonly subjectId: string;
  readonly relation: string;
  readonly relationLabel: string | null;
  readonly objectId: string;
  readonly validFrom: string | null;
  readonly validUntil: string | null;
}

export interface AgentWorldPromptNode {
  readonly id: string;
  readonly kind: string;
  readonly label: string;
  readonly parentId: string | null;
  readonly depth: number;
  readonly lastChangedAt: string | null;
  readonly children: readonly string[];
  readonly attributes: readonly { readonly key: string; readonly value: string }[];
}

export type AgentWorldPromptContextValue = AgentWorldPromptContext | null;

export const EmptyAgentWorldPromptContext: AgentWorldPromptContextValue = null;

export function projectAgentWorldPromptContext(runtime: AgentWorldSnapshotProvider): AgentWorldPromptContext {
  return projectAgentWorldSnapshotPromptContext(runtime.snapshot());
}

export function projectAgentWorldSnapshotPromptContext(snapshot: AgentWorldTreeProjection): AgentWorldPromptContext {
  const context: AgentWorldPromptContext = {
    enabled: true,
    world: snapshot.world,
    time: {
      ...snapshot.time,
      instant: snapshot.time.instant.toString(),
    },
    calendar: snapshot.calendar,
    nodes: snapshot.nodes.map((node) => ({
      id: node.id,
      kind: node.kind,
      label: projectWorldText(node.label),
      parentId: node.parentId,
      depth: node.depth,
      lastChangedAt: node.lastChangedAt,
      children: [...node.children],
      attributes: Object.entries(node.attributes).map(([key, value]) => ({
        key: projectWorldText(key),
        value: projectWorldText(formatWorldValue(value)),
      })),
    })),
    edges: snapshot.edges.map((edge) => ({
      id: edge.id,
      subjectId: edge.subjectId,
      relation: edge.relation,
      relationLabel: edge.relationLabel ?? null,
      objectId: edge.objectId,
      validFrom: edge.validFrom ?? null,
      validUntil: edge.validUntil ?? null,
    })),
    timeline: snapshot.timeline.map((event) => ({
      ...event,
      type: projectWorldText(event.type),
      summary: projectWorldText(event.summary),
      source: projectWorldText(event.source),
    })),
    changedNodeIds: snapshot.changedNodeIds,
    nextSchedules: snapshot.nextSchedules.map((schedule) => ({
      ...schedule,
      label: projectWorldText(schedule.label),
    })),
    commitments: snapshot.commitments.map((commitment) => ({
      ...commitment,
      label: projectWorldText(commitment.label),
      detail: commitment.detail === null ? null : projectWorldText(commitment.detail),
      successCriteria: commitment.successCriteria?.map(projectWorldText),
      blockedReason:
        commitment.blockedReason == null ? commitment.blockedReason : projectWorldText(commitment.blockedReason),
      statusReason:
        commitment.statusReason == null ? commitment.statusReason : projectWorldText(commitment.statusReason),
    })),
    resident: {
      ...snapshot.resident,
      location: projectNullableWorldText(snapshot.resident.location),
      activity: projectNullableWorldText(snapshot.resident.activity),
      bodyState: projectNullableWorldText(snapshot.resident.bodyState),
      emotionState: projectNullableWorldText(snapshot.resident.emotionState),
      interruptedBy: projectNullableWorldText(snapshot.resident.interruptedBy),
      relationship: projectNullableWorldText(snapshot.resident.relationship),
      nextPlan: snapshot.resident.nextPlan
        ? { ...snapshot.resident.nextPlan, label: projectWorldText(snapshot.resident.nextPlan.label) }
        : null,
    },
  };
  return projectAgentModelPayload(context).value as AgentWorldPromptContext;
}

function formatWorldValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function projectWorldText(value: string): string {
  return projectAgentModelText(value).text;
}

function projectNullableWorldText(value: string | null): string | null {
  return value === null ? null : projectWorldText(value);
}
