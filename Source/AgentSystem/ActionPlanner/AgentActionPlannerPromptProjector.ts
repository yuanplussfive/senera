import { z } from "zod";
import { parseJsonText } from "../Core/AgentJsonParsing.js";
import type { AgentLanguageModelMessage } from "../ModelEndpoints/AgentLanguageModel.js";
import { decodePlannerTimelinePayload } from "./AgentPlannerTimelinePayload.js";
import {
  buildCompactionSummarySystemMessages,
  extractPlannerCompactionSummary,
} from "./AgentActionPlannerCompactionSummaryInjector.js";
import { formatTimelineTurnContent, type TimelineTurnInput } from "./AgentPlannerTimelineBlockRegistry.js";
import { DefaultAgentPlannerContextProjectorRegistry } from "./AgentPlannerContextProjectorRegistry.js";
import {
  promptXmlChildren,
  promptXmlJson,
  promptXmlNode,
  promptXmlText,
  serializePromptXml,
  type AgentPromptXmlNode,
} from "./AgentPromptXml.js";

export interface ProjectedActionPlannerPrompt {
  systemPrompt: string;
  messages: AgentLanguageModelMessage[];
}

const PlannerPromptKeys = {
  Context: "context",
  Directive: "directive",
  Timeline: "timeline",
} as const;

const PlannerPromptEnvelopeSchema = z
  .object({
    [PlannerPromptKeys.Context]: z.record(z.string(), z.unknown()),
    [PlannerPromptKeys.Directive]: z.unknown(),
  })
  .passthrough();

const PlannerTimelineTurnSchema = z
  .object({
    index: z.number().optional(),
    role: z.enum(["user", "assistant"]),
    kind: z.string(),
    step: z.number().nullable().optional(),
    content: z.string(),
    payloadJson: z.string().nullable().optional(),
    evidenceUris: z.array(z.string()).optional(),
    artifactUris: z.array(z.string()).optional(),
  })
  .passthrough();

type PlannerTimelineTurnRecord = z.infer<typeof PlannerTimelineTurnSchema>;

export function projectActionPlannerBamlRequestBody(body: Record<string, unknown>): ProjectedActionPlannerPrompt {
  return projectBamlRequestBody(body, projectPlannerConversationMessages);
}

export function projectPlainBamlRequestBody(body: Record<string, unknown>): ProjectedActionPlannerPrompt {
  return projectBamlRequestBody(body, (conversation) => [...conversation]);
}

function projectBamlRequestBody(
  body: Record<string, unknown>,
  projectConversation: (messages: readonly AgentLanguageModelMessage[]) => AgentLanguageModelMessage[],
): ProjectedActionPlannerPrompt {
  const messages = readBamlMessages(body);
  const systemPrompt = messages
    .filter((message) => message.role === "system" || message.role === "developer")
    .map((message) => message.content)
    .join("\n\n");
  const conversation = messages.flatMap((message) => {
    if (message.role === "system" || message.role === "developer") {
      return [];
    }
    return {
      role: message.role,
      content: message.content,
    };
  });

  if (conversation.length === 0) {
    throw new Error("BAML action planner prompt did not contain a user message.");
  }

  return {
    systemPrompt,
    messages: projectConversation(conversation),
  };
}

function projectPlannerConversationMessages(
  messages: readonly AgentLanguageModelMessage[],
): AgentLanguageModelMessage[] {
  const final = messages.at(-1);
  if (!final || final.role !== "user") {
    throw new Error("BAML action planner prompt must end with a JSON user message.");
  }

  const envelope = readPlannerPromptEnvelope(final.content);
  const context = envelope[PlannerPromptKeys.Context];
  const timeline = readPlannerTimeline(context[PlannerPromptKeys.Timeline]);

  const { summaryText, sanitizedContext } = extractPlannerCompactionSummary(context);
  const compactionSummaryMessages = buildCompactionSummarySystemMessages(summaryText);

  const contextWithoutTimeline = omitRecordKeys(sanitizedContext, [PlannerPromptKeys.Timeline]);
  const plannerInputMessage = buildPlannerInputMessage(contextWithoutTimeline, envelope[PlannerPromptKeys.Directive]);

  return [...compactionSummaryMessages, ...timeline.map(projectTimelineTurnMessage), plannerInputMessage];
}

function readPlannerPromptEnvelope(value: string): z.infer<typeof PlannerPromptEnvelopeSchema> {
  const raw = parseJsonText(value, "Action planner prompt envelope");
  const parsed = PlannerPromptEnvelopeSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Invalid action planner prompt envelope: ${parsed.error.message}`);
  }
  return parsed.data;
}

function readPlannerTimeline(value: unknown): PlannerTimelineTurnRecord[] {
  if (value === undefined) {
    return [];
  }

  const parsed = z.array(PlannerTimelineTurnSchema).safeParse(value);
  if (!parsed.success) {
    throw new Error(`Invalid action planner timeline: ${parsed.error.message}`);
  }
  return parsed.data;
}

function projectTimelineTurnMessage(turn: PlannerTimelineTurnRecord): AgentLanguageModelMessage {
  const input: TimelineTurnInput = {
    index: turn.index,
    role: turn.role,
    kind: turn.kind,
    step: turn.step,
    content: turn.content,
    payload: decodePlannerTimelinePayload(turn.payloadJson ?? undefined),
    evidenceUris: turn.evidenceUris,
    artifactUris: turn.artifactUris,
  };
  return {
    role: turn.role,
    content: formatTimelineTurnContent(input),
  };
}

function buildPlannerInputMessage(context: Record<string, unknown>, directive: unknown): AgentLanguageModelMessage {
  const sections = [...projectDirective(directive), ...DefaultAgentPlannerContextProjectorRegistry.project(context)];

  return {
    role: "user",
    content: serializePromptXml(promptXmlNode("planner_input", promptXmlChildren(sections))),
  };
}

function projectDirective(directive: unknown): readonly AgentPromptXmlNode[] {
  if (typeof directive === "string") {
    const value = directive.trim();
    return value ? [promptXmlNode("directive", promptXmlText(value))] : [];
  }
  if (directive !== undefined && directive !== null) {
    return [promptXmlNode("directive", promptXmlJson(directive))];
  }
  return [];
}

function omitRecordKeys(record: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  const excluded = new Set(keys);
  return Object.fromEntries(Object.entries(record).filter(([key]) => !excluded.has(key)));
}

function readBamlMessages(body: Record<string, unknown>): Array<{
  role: AgentLanguageModelMessage["role"];
  content: string;
}> {
  const messages = body.messages;
  if (Array.isArray(messages)) {
    return messages.map(readBamlMessage).filter((message) => message.content.length > 0);
  }

  const input = body.input;
  if (Array.isArray(input)) {
    return input.map(readBamlMessage).filter((message) => message.content.length > 0);
  }

  throw new Error("BAML action planner request did not contain a text prompt.");
}

function readBamlMessage(value: unknown): {
  role: AgentLanguageModelMessage["role"];
  content: string;
} {
  if (!value || typeof value !== "object") {
    throw new Error("BAML action planner message must be an object.");
  }

  const message = value as Record<string, unknown>;
  return {
    role: readRole(message.role),
    content: readTextContent(message.content),
  };
}

function readRole(value: unknown): AgentLanguageModelMessage["role"] {
  if (value === "system" || value === "developer" || value === "assistant" || value === "user") {
    return value;
  }
  throw new Error(`Unsupported BAML action planner message role: ${String(value)}`);
}

function readTextContent(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(readTextPart).join("");
  }

  return "";
}

function readTextPart(value: unknown): string {
  if (!value || typeof value !== "object") {
    return "";
  }

  const part = value as Record<string, unknown>;
  return typeof part.text === "string" ? part.text : "";
}
