import type { AssistantMessage, Context, Message } from "@earendil-works/pi-ai";
import { AgentKeyedLeaseQueue } from "../Core/AgentKeyedLeaseQueue.js";
import { sha256Hex, sha256HexOfCanonicalJson } from "../Core/AgentHash.js";
import { isAgentPiTurnContextWireContent } from "../Pi/AgentPiTurnContextMessage.js";
import type { RegisteredSidecarTool } from "../Types/AgentToolRuntimeTypes.js";
import {
  projectAgentResidentSpeechCommittedMessage,
  projectAgentResidentSpeechSceneMessage,
  projectAgentResidentSpeechSourceMessage,
  projectAgentResidentSpeechSystemPrompt,
} from "./AgentResidentSpeechPromptProjector.js";
import type { AgentResidentSpeechFocus, AgentResidentSpeechUtterance } from "./AgentResidentSpeechTypes.js";

export type AgentResidentSpeechSourceLineage = "initial" | "append" | "rebase";

export interface AgentResidentSpeechSessionContext {
  readonly systemPrompt: string;
  readonly messages: readonly Message[];
}

interface AgentResidentSpeechSessionState {
  readonly systemPromptRevision: string;
  readonly messages: readonly Message[];
  readonly sourceFingerprints: readonly string[];
}

interface AgentResidentSpeechTransactionResult<T> {
  readonly value: T;
  readonly utterance: string;
}

/** Maintains the append-only transcript required by the BAML projection path. */
export class AgentResidentSpeechSessionLedger {
  private readonly sessions = new Map<string, AgentResidentSpeechSessionState>();
  private readonly leases = new AgentKeyedLeaseQueue<string>();

  transact<T>(
    input: {
      readonly sessionId: string;
      readonly context: Context;
      readonly message: AssistantMessage;
      readonly contract: RegisteredSidecarTool;
      readonly focus: AgentResidentSpeechFocus;
      readonly spokenUtterances: readonly AgentResidentSpeechUtterance[];
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
        const committedMessages = sameSystem ? previous.messages : [];
        const scene = projectAgentResidentSpeechSceneMessage({
          focus: input.focus,
          spokenUtterances: input.spokenUtterances,
          lineage,
          sourceMessages: sourceDelta,
          timestamp: input.message.timestamp,
        });
        const requestMessages = [...committedMessages, scene];
        const result = await operation({ systemPrompt, messages: requestMessages });
        const residentMessage = projectAgentResidentSpeechCommittedMessage(input.message, result.utterance);
        this.sessions.set(input.sessionId, {
          systemPromptRevision,
          messages: [...requestMessages, residentMessage],
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

function currentTurnMessages(messages: readonly Message[]): readonly Message[] {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "user" && !isTurnContextMessage(message)) return messages.slice(index);
  }
  return messages;
}

function isTurnContextMessage(message: Extract<Message, { role: "user" }>): boolean {
  return typeof message.content === "string" && isAgentPiTurnContextWireContent(message.content);
}

function isFingerprintPrefix(prefix: readonly string[], value: readonly string[]): boolean {
  return prefix.length <= value.length && prefix.every((fingerprint, index) => value[index] === fingerprint);
}
