import { z } from "zod";
import { promptXmlChildren, promptXmlJson, promptXmlNode, type AgentPromptXmlNode } from "./AgentPromptXml.js";

export interface AgentPlannerContextProjector {
  readonly key: string;
  readonly order: number;
  project(value: unknown): readonly AgentPromptXmlNode[];
}

interface AgentPlannerContextProjectorDefinition<T> {
  readonly key: string;
  readonly order: number;
  readonly schema: z.ZodType<T>;
  project(value: T): readonly AgentPromptXmlNode[];
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

const OpenAiRequestSchema = z
  .object({
    model: z.string().trim().min(1),
    messages: z.array(z.unknown()),
    toolTranscript: z.array(z.unknown()),
    stream: z.boolean(),
  })
  .passthrough();

export function defineAgentPlannerContextProjector<T>(
  definition: AgentPlannerContextProjectorDefinition<T>,
): AgentPlannerContextProjector {
  return Object.freeze({
    key: definition.key,
    order: definition.order,
    project(value: unknown): readonly AgentPromptXmlNode[] {
      const parsed = definition.schema.safeParse(value);
      if (!parsed.success) {
        throw new Error(`Invalid action planner context field "${definition.key}": ${parsed.error.message}`);
      }
      return definition.project(parsed.data);
    },
  });
}

const DefaultContextProjectors: readonly AgentPlannerContextProjector[] = Object.freeze([
  defineAgentPlannerContextProjector({
    key: "seneraRuntime",
    order: 100,
    schema: UnknownRecordSchema,
    project: (value) => [promptXmlNode("runtime_context", promptXmlJson(value))],
  }),
  defineAgentPlannerContextProjector({
    key: "routingCards",
    order: 200,
    schema: z.array(RoutingCardSchema),
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
    key: "openAiRequest",
    order: 300,
    schema: OpenAiRequestSchema,
    project: (value) => [promptXmlNode("openai_request", promptXmlJson(value))],
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
}

export function createAgentPlannerContextProjectorRegistry(
  additionalProjectors: readonly AgentPlannerContextProjector[] = [],
): AgentPlannerContextProjectorRegistry {
  return new AgentPlannerContextProjectorRegistry([...DefaultContextProjectors, ...additionalProjectors]);
}

export const DefaultAgentPlannerContextProjectorRegistry = createAgentPlannerContextProjectorRegistry();
