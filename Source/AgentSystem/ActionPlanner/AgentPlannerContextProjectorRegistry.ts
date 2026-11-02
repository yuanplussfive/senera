import { z } from "zod";
import {
  AgentPromptWireEncodings,
  type AgentPromptWireBlockDescriptor,
  type AgentPromptWireEncoding,
} from "../Prompt/AgentPromptContextWireRenderer.js";
import { promptXmlChildren, promptXmlJson, promptXmlNode, type AgentPromptXmlNode } from "./AgentPromptXml.js";

export interface AgentPlannerContextProjector {
  readonly key: string;
  readonly order: number;
  /** @deprecated Use wire() through AgentPlannerContextProjectorRegistry.normalize(). */
  project(value: unknown): readonly AgentPromptXmlNode[];
  wire(value: unknown): AgentPromptWireBlockDescriptor;
}

interface AgentPlannerContextProjectorDefinition<T> {
  readonly key: string;
  readonly order: number;
  readonly schema: z.ZodType<T>;
  project(value: T): readonly AgentPromptXmlNode[];
  wireEncodings?: readonly AgentPromptWireEncoding[];
}

const UnknownRecordSchema = z.record(z.string(), z.unknown());

const RoutingCardSchema = z
  .object({
    name: z.string().trim().min(1),
    summary: z.string(),
    inputs: z.array(z.string()),
    outputs: z.array(z.string()),
    effects: z.array(z.string()),
  })
  .passthrough();

const PlanningContextSchema = z
  .object({
    model: z.string().trim().min(1),
    messages: z.array(z.unknown()),
    toolTranscript: z.array(z.unknown()),
    toolExecution: z.enum(["parallel", "sequential"]),
  })
  .passthrough();

export function defineAgentPlannerContextProjector<T>(
  definition: AgentPlannerContextProjectorDefinition<T>,
): AgentPlannerContextProjector {
  return Object.freeze({
    key: definition.key,
    order: definition.order,
    project(value: unknown): readonly AgentPromptXmlNode[] {
      const parsed = parseContextValue(definition, value);
      return definition.project(parsed);
    },
    wire(value: unknown): AgentPromptWireBlockDescriptor {
      return {
        id: definition.key,
        value: parseContextValue(definition, value),
        allowedEncodings: definition.wireEncodings ?? [AgentPromptWireEncodings.CompactJson],
      };
    },
  });
}

function parseContextValue<T>(definition: AgentPlannerContextProjectorDefinition<T>, value: unknown): T {
  const parsed = definition.schema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`Invalid action planner context field "${definition.key}": ${parsed.error.message}`);
  }
  return parsed.data;
}

const DefaultContextProjectors: readonly AgentPlannerContextProjector[] = Object.freeze([
  defineAgentPlannerContextProjector({
    key: "seneraRuntime",
    order: 100,
    schema: UnknownRecordSchema,
    wireEncodings: [AgentPromptWireEncodings.Toon, AgentPromptWireEncodings.CompactJson],
    project: (value) => [promptXmlNode("runtime_context", promptXmlJson(value))],
  }),
  defineAgentPlannerContextProjector({
    key: "routingCards",
    order: 200,
    schema: z.array(RoutingCardSchema),
    wireEncodings: [AgentPromptWireEncodings.Toon, AgentPromptWireEncodings.CompactJson],
    project: (cards) => [
      promptXmlNode(
        "routing_cards",
        promptXmlChildren(
          cards.map((card, index) =>
            promptXmlNode("routing_card", promptXmlJson(card), {
              index,
              name: card.name,
            }),
          ),
        ),
      ),
    ],
  }),
  defineAgentPlannerContextProjector({
    key: "planningContext",
    order: 300,
    schema: PlanningContextSchema,
    wireEncodings: [AgentPromptWireEncodings.CompactJson],
    project: (value) => [promptXmlNode("planning_context", promptXmlJson(value))],
  }),
]);

export class AgentPlannerContextProjectorRegistry {
  private readonly projectors: readonly AgentPlannerContextProjector[];
  private readonly knownKeys: ReadonlySet<string>;

  constructor(projectors: readonly AgentPlannerContextProjector[]) {
    const keys = new Set<string>();
    for (const projector of projectors) {
      if (keys.has(projector.key)) {
        throw new Error(`Duplicate action planner context projector key: "${projector.key}"`);
      }
      keys.add(projector.key);
    }

    this.projectors = Object.freeze(
      [...projectors].sort(
        (left, right) => left.order - right.order || (left.key < right.key ? -1 : left.key > right.key ? 1 : 0),
      ),
    );
    this.knownKeys = keys;
  }

  /** @deprecated Use normalize() with the shared prompt wire. */
  /** @deprecated XML is retained only for historical planner consumers. */
  project(context: Readonly<Record<string, unknown>>): readonly AgentPromptXmlNode[] {
    const nodes: AgentPromptXmlNode[] = [];
    for (const projector of this.projectors) {
      const value = context[projector.key];
      if (value !== undefined && value !== null) {
        nodes.push(...projector.project(value));
      }
    }

    const extraContext = Object.fromEntries(
      Object.entries(context).filter(
        ([key, value]) => !this.knownKeys.has(key) && value !== undefined && value !== null,
      ),
    );
    if (Object.keys(extraContext).length > 0) {
      nodes.push(promptXmlNode("extra_context", promptXmlJson(extraContext)));
    }

    return nodes;
  }

  /**
   * Validates and normalizes planner context before it enters the shared wire.
   * The normalized object is the canonical model input; XML projection is only
   * retained for callers that still consume the compatibility API above.
   */
  normalize(context: Readonly<Record<string, unknown>>): Record<string, unknown> {
    const blocks = this.projectWireBlocks(context);
    const normalized: Record<string, unknown> = {};
    for (const block of blocks) {
      if (block.id === "extra_context") {
        if (!block.value || typeof block.value !== "object" || Array.isArray(block.value)) {
          throw new Error("Planner extra_context must be an object.");
        }
        Object.assign(normalized, block.value);
        continue;
      }
      normalized[block.id] = block.value;
    }
    return normalized;
  }

  /** Returns validated, ordered wire blocks for the canonical model envelope. */
  projectWireBlocks(context: Readonly<Record<string, unknown>>): readonly AgentPromptWireBlockDescriptor[] {
    const blocks: AgentPromptWireBlockDescriptor[] = [];
    for (const projector of this.projectors) {
      const value = context[projector.key];
      if (value !== undefined && value !== null) blocks.push(projector.wire(value));
    }

    const extraContext = Object.fromEntries(
      Object.entries(context).filter(
        ([key, value]) => !this.knownKeys.has(key) && value !== undefined && value !== null,
      ),
    );
    if (Object.keys(extraContext).length > 0) {
      blocks.push({
        id: "extra_context",
        value: extraContext,
        allowedEncodings: [AgentPromptWireEncodings.CompactJson],
      });
    }
    return blocks;
  }
}

export function createAgentPlannerContextProjectorRegistry(
  additionalProjectors: readonly AgentPlannerContextProjector[] = [],
): AgentPlannerContextProjectorRegistry {
  return new AgentPlannerContextProjectorRegistry([...DefaultContextProjectors, ...additionalProjectors]);
}

export const DefaultAgentPlannerContextProjectorRegistry = createAgentPlannerContextProjectorRegistry();
