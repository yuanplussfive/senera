import type { AssistantMessage, Context, Message } from "@earendil-works/pi-ai";
import { AgentKeyedLeaseQueue } from "../Core/AgentKeyedLeaseQueue.js";
import { sha256Hex, sha256HexOfCanonicalJson } from "../Core/AgentHash.js";
import { isAgentPiTurnContextWireContent } from "../Pi/AgentPiTurnContextMessage.js";
import type { RegisteredSidecarTool } from "../Types/AgentToolRuntimeTypes.js";
import {
  type AgentResidentSpeechConversationMessage,
  projectAgentResidentSpeechSceneMessage,
  projectAgentResidentSpeechSourceMessage,
  projectAgentResidentSpeechSourceValues,
  projectAgentResidentSpeechSystemPrompt,
} from "./AgentResidentSpeechPromptProjector.js";
import type {
  AgentResidentSpeechFocus,
  AgentResidentSpeechProjectionTier,
  AgentResidentSpeechUtterance,
} from "./AgentResidentSpeechTypes.js";
import { AgentModelInputBudgetError, type AgentModelInputInspection } from "../Text/AgentTurnTokenBudget.js";
import { AgentTokenProjector } from "../Text/AgentTokenProjection.js";

export type AgentResidentSpeechSourceLineage = "initial" | "append" | "rebase";

export interface AgentResidentSpeechSessionContext {
  readonly systemPrompt: string;
  readonly messages: readonly AgentResidentSpeechConversationMessage[];
}

interface AgentResidentSpeechSessionState {
  readonly systemPromptRevision: string;
  readonly messages: readonly AgentResidentSpeechConversationMessage[];
  readonly sourceFingerprints: readonly string[];
}

interface AgentResidentSpeechTransactionResult<T> {
  readonly value: T;
  readonly utterance: string;
}

/** Maintains a bounded, rebuildable derived transcript for the BAML path. */
export class AgentResidentSpeechSessionLedger {
  private readonly sessions = new Map<string, AgentResidentSpeechSessionState>();
  private readonly leases = new AgentKeyedLeaseQueue<string>();

  transact<T>(
    input: {
      readonly sessionId: string;
      readonly context: Context;
      readonly message: AssistantMessage;
      readonly contract: RegisteredSidecarTool;
      readonly model: string;
      readonly inspect: (context: AgentResidentSpeechSessionContext) => AgentModelInputInspection;
      readonly focus: AgentResidentSpeechFocus;
      readonly spokenUtterances: readonly AgentResidentSpeechUtterance[];
      readonly projectionTier?: AgentResidentSpeechProjectionTier;
      readonly signal?: AbortSignal;
    },
    operation: (context: AgentResidentSpeechSessionContext) => Promise<AgentResidentSpeechTransactionResult<T>>,
  ): Promise<T> {
    return this.leases.run(
      input.sessionId,
      async () => {
        const systemPrompt = projectAgentResidentSpeechSystemPrompt(input.context.systemPrompt, input.contract);
        const systemPromptRevision = sha256Hex(systemPrompt);
        const previous = this.sessions.get(input.sessionId);
        const currentSource = input.context.messages.map(projectAgentResidentSpeechSourceMessage);
        const sourceFingerprints = currentSource.map(sha256HexOfCanonicalJson);
        const sameSystem = previous !== undefined && previous.systemPromptRevision === systemPromptRevision;
        const sourceExtendsPrevious =
          sameSystem && isFingerprintPrefix(previous.sourceFingerprints, sourceFingerprints);
        const lineage: AgentResidentSpeechSourceLineage = !sameSystem
          ? "initial"
          : sourceExtendsPrevious
            ? "append"
            : "rebase";
        const sourceDelta = sourceExtendsPrevious
          ? input.context.messages.slice(previous.sourceFingerprints.length)
          : currentTurnMessages(input.context.messages);
        // A non-prefix source is a new Pi lineage (compaction, rewind, fork,
        // recovery, or provider-context rebuild). Keeping the old derived
        // messages here would make the sidecar grow after every rebase.
        const committedMessages = sourceExtendsPrevious ? previous.messages : [];
        const sourceValues = projectAgentResidentSpeechSourceValues(sourceDelta, input.model);
        const scene = projectAgentResidentSpeechSceneMessage({
          focus: input.focus,
          spokenUtterances: input.spokenUtterances,
          projectionTier: input.projectionTier,
          lineage,
          sourceMessages: sourceDelta,
          sourceMessageValues: sourceValues,
        });
        const request = fitResidentSpeechRequest({
          systemPrompt,
          committedMessages,
          sourceValues,
          scene,
          model: input.model,
          inspect: input.inspect,
          buildScene: (sourceMessageValues) =>
            projectAgentResidentSpeechSceneMessage({
              focus: input.focus,
              spokenUtterances: input.spokenUtterances,
              projectionTier: input.projectionTier,
              lineage,
              sourceMessages: sourceDelta,
              sourceMessageValues,
            }),
        });
        const result = await operation(request);
        const residentMessage: AgentResidentSpeechConversationMessage = {
          role: "assistant",
          content: result.utterance,
        };
        this.sessions.set(input.sessionId, {
          systemPromptRevision,
          messages: [...request.messages, residentMessage],
          sourceFingerprints,
        });
        return result.value;
      },
      input.signal,
    );
  }

  resetSession(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  close(): void {
    this.sessions.clear();
  }
}

function fitResidentSpeechRequest(input: {
  readonly systemPrompt: string;
  readonly committedMessages: readonly AgentResidentSpeechConversationMessage[];
  readonly sourceValues: readonly unknown[];
  readonly scene: AgentResidentSpeechConversationMessage;
  readonly model: string;
  readonly inspect: (context: AgentResidentSpeechSessionContext) => AgentModelInputInspection;
  readonly buildScene: (sourceMessageValues: readonly unknown[]) => AgentResidentSpeechConversationMessage;
}): AgentResidentSpeechSessionContext {
  const raw = {
    systemPrompt: input.systemPrompt,
    messages: [...input.committedMessages, input.scene],
  } satisfies AgentResidentSpeechSessionContext;
  const inspection = input.inspect(raw);
  if (inspection.fits) return raw;

  const empty = {
    systemPrompt: input.systemPrompt,
    messages: [input.buildScene([])],
  } satisfies AgentResidentSpeechSessionContext;
  const emptyInspection = input.inspect(empty);
  if (!emptyInspection.fits) {
    throw new AgentModelInputBudgetError(emptyInspection);
  }

  const projector = new AgentTokenProjector(input.model);
  let lower = 0;
  let upper = inspection.capacityTokens;
  let best = empty;
  while (lower <= upper) {
    const middle = Math.floor((lower + upper) / 2);
    const projected = projectResidentSpeechDynamicMessages(
      input.committedMessages,
      input.sourceValues,
      projector,
      middle,
    );
    const candidate = {
      systemPrompt: input.systemPrompt,
      messages: [...projected.committedMessages, input.buildScene(projected.sourceValues)],
    } satisfies AgentResidentSpeechSessionContext;
    const candidateInspection = input.inspect(candidate);
    if (candidateInspection.fits) {
      best = candidate;
      lower = middle + 1;
    } else {
      upper = middle - 1;
    }
  }
  return best;
}

function projectResidentSpeechDynamicMessages(
  committedMessages: readonly AgentResidentSpeechConversationMessage[],
  sourceValues: readonly unknown[],
  projector: AgentTokenProjector,
  tokenLimit: number,
): {
  readonly committedMessages: readonly AgentResidentSpeechConversationMessage[];
  readonly sourceValues: readonly unknown[];
} {
  if (tokenLimit <= 0) return { committedMessages: [], sourceValues: [] };
  const projected = projector.projectJson(
    {
      // Keep the newest derived context first during projection, then restore
      // chronological order for the model-facing conversation.
      history: [...committedMessages].reverse(),
      source: [...sourceValues].reverse(),
    },
    tokenLimit,
  ).projectedValue;
  if (!projected || typeof projected !== "object" || Array.isArray(projected)) {
    throw new Error("Resident speech dynamic context projection must remain an object.");
  }
  const value = projected as { history?: unknown; source?: unknown };
  if (value.source !== undefined && !Array.isArray(value.source)) {
    throw new Error("Resident speech dynamic source projection must remain an array.");
  }
  return {
    committedMessages: readResidentSpeechConversationMessages(value.history).reverse(),
    sourceValues: (Array.isArray(value.source) ? [...value.source] : []).reverse(),
  };
}

function readResidentSpeechConversationMessages(value: unknown): AgentResidentSpeechConversationMessage[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const candidate = entry as { role?: unknown; content?: unknown };
    if ((candidate.role !== "user" && candidate.role !== "assistant") || typeof candidate.content !== "string") {
      return [];
    }
    return [{ role: candidate.role, content: candidate.content }];
  });
}

function currentTurnMessages(messages: readonly Message[]): readonly Message[] {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "user" && !isTurnContextMessage(message)) return messages.slice(index);
  }
  return messages;
}

function isTurnContextMessage(message: Extract<Message, { role: "user" }>): boolean {
  const content =
    typeof message.content === "string"
      ? message.content
      : message.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("");
  return isAgentPiTurnContextWireContent(content);
}

function isFingerprintPrefix(prefix: readonly string[], value: readonly string[]): boolean {
  return prefix.length <= value.length && prefix.every((fingerprint, index) => value[index] === fingerprint);
}
