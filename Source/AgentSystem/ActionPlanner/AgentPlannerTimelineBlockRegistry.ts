import { z } from "zod";
import { readRecord, readString } from "./AgentActionPlannerProjectionUtils.js";
import {
  promptXmlChildren,
  promptXmlJson,
  promptXmlNode,
  promptXmlText,
  serializePromptXml,
  type AgentPromptXmlNode,
} from "./AgentPromptXml.js";

export interface TimelineTurnInput {
  readonly index: number | undefined;
  readonly role: "user" | "assistant";
  readonly kind: string;
  readonly step: number | null | undefined;
  readonly content: string;
  readonly payload: unknown;
  readonly evidenceUris: readonly string[] | undefined;
  readonly artifactUris: readonly string[] | undefined;
}

export interface AgentPlannerTimelineProjector {
  readonly kinds: readonly string[];
  project(turn: TimelineTurnInput): readonly AgentPromptXmlNode[];
}

interface AgentPlannerTimelineProjectorDefinition<T> {
  readonly kinds: readonly string[];
  readonly payloadSchema: z.ZodType<T>;
  project(turn: TimelineTurnInput, payload: T): readonly AgentPromptXmlNode[];
}

const ToolCallSchema = z
  .object({
    name: z.string().optional(),
    callId: z.string().optional(),
    id: z.string().optional(),
    arguments: z.unknown().optional(),
  })
  .passthrough();

const ToolObservationSchema = z
  .object({
    callId: z.string().optional(),
    name: z.string().optional(),
    status: z.string().optional(),
    response: z
      .object({
        ok: z.boolean().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

const ToolCallsPayloadSchema = z
  .object({
    calls: singletonOrArray(ToolCallSchema),
  })
  .passthrough();

const ToolObservationsPayloadSchema = z
  .object({
    observations: singletonOrArray(ToolObservationSchema),
  })
  .passthrough();

const OptionalUnknownPayloadSchema = z.unknown().optional();

export function defineAgentPlannerTimelineProjector<T>(
  definition: AgentPlannerTimelineProjectorDefinition<T>,
): AgentPlannerTimelineProjector {
  if (definition.kinds.length === 0) {
    throw new Error("An action planner timeline projector must declare at least one kind.");
  }

  return Object.freeze({
    kinds: Object.freeze([...definition.kinds]),
    project(turn: TimelineTurnInput): readonly AgentPromptXmlNode[] {
      const parsed = definition.payloadSchema.safeParse(turn.payload);
      if (!parsed.success) {
        throw new Error(`Invalid action planner timeline payload for kind "${turn.kind}": ${parsed.error.message}`);
      }
      return definition.project(turn, parsed.data);
    },
  });
}

export class AgentPlannerTimelineProjectorRegistry {
  private readonly projectorsByKind: ReadonlyMap<string, AgentPlannerTimelineProjector>;

  constructor(projectors: readonly AgentPlannerTimelineProjector[]) {
    const byKind = new Map<string, AgentPlannerTimelineProjector>();
    for (const projector of projectors) {
      for (const kind of projector.kinds) {
        if (byKind.has(kind)) {
          throw new Error(`Duplicate action planner timeline projector kind: "${kind}"`);
        }
        byKind.set(kind, projector);
      }
    }
    this.projectorsByKind = byKind;
  }

  project(turn: TimelineTurnInput): readonly AgentPromptXmlNode[] {
    const projector = this.projectorsByKind.get(turn.kind);
    return projector ? projector.project(turn) : projectUnknownTurn(turn);
  }
}

const DefaultTimelineProjectors: readonly AgentPlannerTimelineProjector[] = Object.freeze([
  defineTextProjector("tool_preface", "preface"),
  defineTextProjector("final_answer", "answer", { terminal: true }),
  defineTextProjector("ask_user", "ask"),
  defineMessageProjector("user_message", "user", "userMessage"),
  defineMessageProjector("assistant_message", "message", "message"),
  defineAgentPlannerTimelineProjector({
    kinds: ["tool_call"],
    payloadSchema: ToolCallsPayloadSchema,
    project: (_turn, payload) => {
      const blocks = payload.calls.map((call, index) =>
        promptXmlNode("call", promptXmlJson(call), {
          index,
          name: readString(call.name),
          id: readString(call.callId) ?? readString(call.id),
        }),
      );
      return appendPayloadMetadata(blocks, payload, ["calls"]);
    },
  }),
  defineAgentPlannerTimelineProjector({
    kinds: ["tool_observation", "tool_results"],
    payloadSchema: ToolObservationsPayloadSchema,
    project: (_turn, payload) => {
      const blocks = payload.observations.map((observation) =>
        promptXmlNode("result", promptXmlJson(observation), {
          call_id: readString(observation.callId),
          name: readString(observation.name),
          status: resolveObservationStatus(observation),
        }),
      );
      return appendPayloadMetadata(blocks, payload, ["observations"]);
    },
  }),
  defineAgentPlannerTimelineProjector({
    kinds: ["xml_observation"],
    payloadSchema: OptionalUnknownPayloadSchema,
    project: (turn, payload) => {
      const record = readRecord(payload);
      const value = record && "value" in record ? record.value : payload;
      return [
        promptXmlNode("observation", promptXmlJson(value), {
          source: "xml",
          root: readString(record?.xmlRoot),
        }),
      ];
    },
  }),
  defineAgentPlannerTimelineProjector({
    kinds: ["memory_user_message", "memory_assistant_context", "memory_tool_evidence", "memory_artifact"],
    payloadSchema: OptionalUnknownPayloadSchema,
    project: (turn, payload) => [buildLosslessBlock("memory_source", turn.content, payload, { type: turn.kind })],
  }),
]);

export function createAgentPlannerTimelineProjectorRegistry(
  additionalProjectors: readonly AgentPlannerTimelineProjector[] = [],
): AgentPlannerTimelineProjectorRegistry {
  return new AgentPlannerTimelineProjectorRegistry([...DefaultTimelineProjectors, ...additionalProjectors]);
}

export const DefaultAgentPlannerTimelineProjectorRegistry = createAgentPlannerTimelineProjectorRegistry();

/**
 * Projects one validated turn by direct `kind` lookup. Unknown kinds are
 * represented losslessly and are never routed by probing payload fields.
 */
export function formatTimelineTurnContent(
  turn: TimelineTurnInput,
  registry: AgentPlannerTimelineProjectorRegistry = DefaultAgentPlannerTimelineProjectorRegistry,
): string {
  const blocks = [...registry.project(turn), ...projectTurnReferences(turn)];
  if (blocks.length === 0) return "";

  return serializePromptXml(
    promptXmlNode("timeline_turn", promptXmlChildren(blocks), {
      index: turn.index,
      role: turn.role,
      kind: turn.kind || undefined,
      step: turn.step,
    }),
  );
}

function defineTextProjector(
  kind: string,
  tag: string,
  attributes?: AgentPromptXmlNode["attributes"],
): AgentPlannerTimelineProjector {
  return defineAgentPlannerTimelineProjector({
    kinds: [kind],
    payloadSchema: OptionalUnknownPayloadSchema,
    project: (turn, payload) => [buildLosslessBlock(tag, turn.content, payload, attributes)],
  });
}

function defineMessageProjector(
  kind: string,
  tag: string,
  payloadKey: "message" | "userMessage",
): AgentPlannerTimelineProjector {
  return defineAgentPlannerTimelineProjector({
    kinds: [kind],
    payloadSchema: OptionalUnknownPayloadSchema,
    project: (turn, payload) => {
      const payloadText = readPayloadMessage(payload, payloadKey);
      return [buildLosslessBlock(tag, payloadText ?? turn.content, payload)];
    },
  });
}

function projectUnknownTurn(turn: TimelineTurnInput): readonly AgentPromptXmlNode[] {
  if (turn.content.trim().length === 0 && turn.payload === undefined) return [];
  const tag = turn.role === "user" ? "user" : "message";
  return [buildLosslessBlock(tag, turn.content, turn.payload)];
}

function buildLosslessBlock(
  tag: string,
  content: string,
  payload: unknown,
  attributes?: AgentPromptXmlNode["attributes"],
): AgentPromptXmlNode {
  const hasContent = content.trim().length > 0;
  const hasPayload = payload !== undefined;

  if (hasContent && !hasPayload) {
    return promptXmlNode(tag, promptXmlText(content), attributes);
  }
  if (!hasContent && hasPayload) {
    return promptXmlNode(tag, promptXmlJson(payload), attributes);
  }

  const children: AgentPromptXmlNode[] = [];
  if (hasContent) children.push(promptXmlNode("content", promptXmlText(content)));
  if (hasPayload) children.push(promptXmlNode("payload", promptXmlJson(payload)));
  return promptXmlNode(tag, promptXmlChildren(children), attributes);
}

function projectTurnReferences(turn: TimelineTurnInput): readonly AgentPromptXmlNode[] {
  return [
    ...(turn.evidenceUris ?? []).map((uri) => promptXmlNode("evidence_uri", promptXmlText(uri))),
    ...(turn.artifactUris ?? []).map((uri) => promptXmlNode("artifact_uri", promptXmlText(uri))),
  ];
}

function readPayloadMessage(payload: unknown, key: "message" | "userMessage"): string | undefined {
  const value = readRecord(payload)?.[key];
  if (typeof value === "string") return value;
  return readString(readRecord(value)?.content);
}

function resolveObservationStatus(observation: z.infer<typeof ToolObservationSchema>): string | undefined {
  if (observation.response?.ok === true) return "success";
  if (observation.response?.ok === false) return "failed";
  return readString(observation.status);
}

function appendPayloadMetadata(
  blocks: readonly AgentPromptXmlNode[],
  payload: Readonly<Record<string, unknown>>,
  consumedKeys: readonly string[],
): readonly AgentPromptXmlNode[] {
  const consumed = new Set(consumedKeys);
  const metadata = Object.fromEntries(Object.entries(payload).filter(([key]) => !consumed.has(key)));
  return Object.keys(metadata).length > 0
    ? [...blocks, promptXmlNode("payload_metadata", promptXmlJson(metadata))]
    : blocks;
}

function singletonOrArray<T>(schema: z.ZodType<T>): z.ZodType<T[]> {
  return z.union([schema, z.array(schema)]).transform((value) => (Array.isArray(value) ? value : [value]));
}
