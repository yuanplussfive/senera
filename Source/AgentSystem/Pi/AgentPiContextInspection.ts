import { createHash } from "node:crypto";
import {
  getCurrentSystemPrompt,
  getCurrentTools,
  normalizeContext,
  type AssistantMessage,
  type Context,
  type Message,
} from "@earendil-works/pi-ai";
import type { AgentModelContextSection, AgentModelContextSnapshot } from "../Events/AgentModelContextSnapshot.js";
import type { AgentResourcePublisher } from "../Resources/AgentResourcePublisher.js";
import { AgentModelTokenEstimator } from "../Text/AgentTextBudget.js";
import {
  estimateAgentModelInputTokens,
  projectAgentModelInputForTokenBudget,
} from "../Text/AgentMultimodalTokenBudget.js";
import type { AgentPiTurnState } from "./AgentPiTurnState.js";

/** Session-local content reuse keeps repeated request snapshots small on the wire and on disk. */
export class AgentPiContextInspection {
  private readonly sections = new Map<string, Promise<AgentModelContextSection>>();

  async capture(input: {
    context: Context;
    model: string;
    scope: AgentModelContextSnapshot["scope"];
    state: AgentPiTurnState;
  }): Promise<AgentModelContextSnapshot> {
    const context = normalizeContext(input.context);
    const estimator = new AgentModelTokenEstimator({ model: input.model });
    const budget = input.state.context.tokenBudget.snapshot();
    const describe = (
      category: AgentModelContextSection["category"],
      label: string,
      value: unknown,
      extra: Pick<AgentModelContextSection, "toolCallId" | "isError"> = {},
    ) => {
      const projection = projectAgentModelInputForTokenBudget(value);
      const content = typeof value === "string" ? value : JSON.stringify(JSON.parse(projection.text), null, 2);
      const id = createHash("sha256")
        .update(input.model)
        .update("\0")
        .update(category)
        .update("\0")
        .update(content)
        // Binary stays out of the readable resource, but a different image
        // must still have a different identity in request comparisons.
        .update(projection.imageCount > 0 ? JSON.stringify(value) : "")
        .digest("hex");
      return { id, category, label, content, projection, extra };
    };
    // Capture all values before yielding to storage. Pi may continue appending
    // to its transcript while this independent observation is being saved.
    const system = getCurrentSystemPrompt(context.messages);
    const entries = [
      ...(system ? [describe("system", "system", system)] : []),
      ...getCurrentTools(context.messages).map((tool) => describe("tools", tool.name, tool)),
      ...context.messages
        .filter((message) => message.role !== "system")
        .flatMap(inspectMessageParts)
        .map((part) => describe(part.category, part.label, part.content, part.extra)),
    ];
    const sections: AgentModelContextSection[] = [];
    for (const { id, category, label, content, projection, extra } of entries) {
      let pending = this.sections.get(id);
      if (!pending) {
        pending = this.publish(
          {
            id,
            category,
            label,
            tokens: estimateAgentModelInputTokens(estimator, JSON.parse(projection.text)),
            characters: content.length,
            images: projection.imageCount,
          },
          content,
          input.state.context.contextPublisher,
          readContextOwner(input.state),
        );
        this.sections.set(id, pending);
        // A failed publication is visible for this request, but must not poison
        // every later request after storage becomes available again.
        void pending.then((section) => {
          if (!section.resourceUri && this.sections.get(id) === pending) this.sections.delete(id);
        });
      }
      sections.push({ ...(await pending), ...extra, label });
    }
    return {
      format: "pi-input/v1",
      scope: input.scope,
      measurement: "local_estimate",
      contextWindow: budget.contextWindowTokens,
      reserveTokens: budget.windowHeadroomTokens,
      estimatedTokens: sections.reduce((total, section) => total + section.tokens, 0),
      sections,
    };
  }

  private async publish(
    section: AgentModelContextSection,
    content: string,
    publisher: AgentResourcePublisher | undefined,
    owner: { sessionId: string; requestId: string } | undefined,
  ): Promise<AgentModelContextSection> {
    if (!publisher) return section;
    try {
      const resource = await publisher.publishBytes({
        bytes: Buffer.from(content),
        name: `context-${section.id}.txt`,
        mime: "text/plain",
        ...(owner ? { retention: "persistent" as const, owner } : {}),
      });
      return { ...section, resourceUri: resource.resourceUri };
    } catch (error) {
      // Inspection availability must not change the provider request or claim that content was saved.
      return { ...section, contentError: error instanceof Error ? error.message : String(error) };
    }
  }
}

interface InspectionMessagePart {
  category: AgentModelContextSection["category"];
  label: string;
  content: unknown;
  extra?: Pick<AgentModelContextSection, "toolCallId" | "isError">;
}

/** Read Pi's typed blocks, preserving their order; an assistant role alone does not identify its contents. */
function inspectMessageParts(message: Exclude<Message, { role: "system" }>): InspectionMessagePart[] {
  if (message.role !== "assistant")
    return [
      {
        category: message.role,
        label: message.role === "toolResult" ? message.toolName : message.role,
        content: message.content,
        extra: message.role === "toolResult" ? { toolCallId: message.toolCallId, isError: message.isError } : undefined,
      },
    ];
  const preface = message.content.some((block) => block.type === "toolCall");
  const groups: (Omit<InspectionMessagePart, "content"> & { content: AssistantMessage["content"] })[] = [];
  for (const block of message.content) {
    const category =
      block.type === "thinking"
        ? "thinking"
        : block.type === "toolCall"
          ? "toolCall"
          : preface
            ? "preface"
            : "assistant";
    const previous = groups.at(-1);
    if (category !== "toolCall" && previous?.category === category) previous.content.push(block);
    else
      groups.push({
        category,
        label: block.type === "toolCall" ? block.name : category,
        content: [block],
        ...(block.type === "toolCall" ? { extra: { toolCallId: block.id } } : {}),
      });
  }
  return groups;
}

function readContextOwner(state: AgentPiTurnState): { sessionId: string; requestId: string } | undefined {
  const sessionId = state.context.sessionId;
  return sessionId ? { sessionId, requestId: state.context.requestId } : undefined;
}
