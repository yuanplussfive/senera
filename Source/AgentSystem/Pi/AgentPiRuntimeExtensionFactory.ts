import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ExtensionFactory, SessionManager } from "@earendil-works/pi-coding-agent";
import { errorMessage } from "../Core/AgentErrors.js";
import {
  AgentPiProxyContextHeader,
  AgentPiProxyModelProviderHeader,
  composePiProxyRequestHeaders,
  encodePiProxyModelProviderHeaderValue,
} from "../PiShared/AgentPiProxyProtocol.js";
import type { AgentTurnTokenBudget } from "../Text/AgentTurnTokenBudget.js";
import type { ResolvedAgentModelProviderConfig } from "../Types/AgentConfigTypes.js";
import { applyAgentPiContextPolicy } from "./AgentPiContextPolicy.js";
import {
  AgentPiArtifactIndexCustomType,
  createAgentPiArtifactIndex,
  readAgentPiArtifactIndex,
  type AgentPiArtifactIndex,
} from "./AgentPiArtifactIndex.js";
import {
  AgentPiCompactionToolIndexCustomType,
  createAgentPiCompactionToolCallIndex,
  readAgentPiCompactionToolCallIndex,
  type AgentPiCompactionToolCallIndex,
} from "./AgentPiCompactionToolIndex.js";
import {
  AgentPiCompactionSummaryBridge,
  type AgentPiCompactionSummaryBridgeOptions,
} from "./AgentPiCompactionSummaryBridge.js";
import { DefaultAgentPiCompactionSummaryFormatterOptions } from "./AgentPiCompactionSummaryFormatter.js";
import {
  agentPiDiagnosticContext,
  type AgentPiCodingAgentSessionFrame,
  type AgentPiMutableSessionFrame,
} from "./AgentPiCodingAgentSessionFrame.js";
import { AgentPiDiagnosticSources, emitAgentPiDiagnostic, type AgentPiDiagnosticSink } from "./AgentPiDiagnostics.js";
import { renderPiSystemPromptFrame } from "./AgentPiPromptFrameProjector.js";
import {
  AgentPiToolObservationBatchProjector,
  type AgentPiToolObservationBatchInspection,
} from "./AgentPiToolObservationBatchProjector.js";
import type { AgentPiToolObservationDigester } from "./AgentPiToolObservationDigester.js";
import { projectAgentPiToolResultStatus } from "./AgentPiToolResultPolicy.js";
import type { AgentPiProviderProjection } from "./AgentPiTypes.js";

export interface AgentPiRuntimeExtensionFactoryOptions {
  readonly provider: AgentPiProviderProjection;
  readonly modelProvider: ResolvedAgentModelProviderConfig;
  readonly toolObservationDigester?: AgentPiToolObservationDigester;
  readonly diagnostics?: AgentPiDiagnosticSink;
}

export class AgentPiRuntimeExtensionFactory {
  constructor(private readonly options: AgentPiRuntimeExtensionFactoryOptions) {}

  create(
    frame: AgentPiMutableSessionFrame,
    sessionManager: SessionManager,
  ): { name: string; hidden: true; factory: ExtensionFactory } {
    const observationProjector = new AgentPiToolObservationBatchProjector({
      model: this.options.provider.model.id,
      contextWindowTokens: this.options.provider.model.contextWindow,
      outputReserveTokens: this.options.provider.model.maxTokens,
    });
    const digestSession = this.options.toolObservationDigester?.createSession();
    let pendingCompactionIndex: AgentPiArtifactIndex | undefined;
    let pendingCompactionToolIndex: AgentPiCompactionToolCallIndex | undefined;
    const reportedInvalidArtifactIndexes = new Set<string>();
    const reportedInvalidToolIndexes = new Set<string>();
    const compactionSummaryBridge = new AgentPiCompactionSummaryBridge({
      formatterOptions: {
        ...DefaultAgentPiCompactionSummaryFormatterOptions,
        model: this.options.provider.model.id,
      },
    } satisfies AgentPiCompactionSummaryBridgeOptions);
    return {
      name: "senera-runtime",
      hidden: true,
      factory: (pi) => {
        pi.on("before_provider_headers", (event) => {
          const snapshot = frame.snapshot();
          event.headers.authorization = `Bearer ${this.options.provider.apiKey}`;
          const providerHeaders = composePiProxyRequestHeaders(
            {
              ...this.options.provider.headers,
              [AgentPiProxyModelProviderHeader]: encodePiProxyModelProviderHeaderValue(this.options.modelProvider.Id),
            },
            snapshot.piTurnContextId,
          );
          for (const [name, value] of Object.entries(providerHeaders)) event.headers[name] = value;
          if (!snapshot.piTurnContextId) event.headers[AgentPiProxyContextHeader] = null;
        });
        pi.on("before_agent_start", (event) => {
          const snapshot = frame.snapshot();
          return {
            systemPrompt: [
              renderPiSystemPromptFrame({
                systemPrompt: snapshot.systemPrompt ?? "",
                skills: frame.skillSnapshot(),
                selectedPromptTemplates: snapshot.selectedPromptTemplates,
              }),
              event.systemPrompt,
            ]
              .filter((value) => value.trim().length > 0)
              .join("\n\n"),
          };
        });
        pi.on("tool_call", (event) =>
          frame.snapshot().preflight({
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            input: event.input,
          }),
        );
        pi.on("tool_result", (event) => projectAgentPiToolResultStatus(event.details));
        pi.on("session_before_compact", (event) => {
          const previous = readAgentPiArtifactIndex(event.branchEntries).artifacts;
          pendingCompactionIndex = createAgentPiArtifactIndex(previous, event.preparation.messagesToSummarize);
          pendingCompactionToolIndex = createAgentPiCompactionToolCallIndex(event.preparation.messagesToSummarize);
        });
        pi.on("session_compact", () => {
          const index = pendingCompactionIndex;
          pendingCompactionIndex = undefined;
          if (index && index.artifacts.length > 0) pi.appendEntry(AgentPiArtifactIndexCustomType, index);
          const toolIndex = pendingCompactionToolIndex;
          pendingCompactionToolIndex = undefined;
          if (toolIndex && toolIndex.calls.length > 0) {
            pi.appendEntry(AgentPiCompactionToolIndexCustomType, toolIndex);
          }
        });
        pi.on("context", async (event) => {
          const snapshot = frame.snapshot();
          const contextEntries = sessionManager.buildContextEntries();
          const artifactIndex = readAgentPiArtifactIndex(contextEntries);
          if (artifactIndex.invalidEntryId && !reportedInvalidArtifactIndexes.has(artifactIndex.invalidEntryId)) {
            reportedInvalidArtifactIndexes.add(artifactIndex.invalidEntryId);
            await emitAgentPiDiagnostic(snapshot.diagnostics ?? this.options.diagnostics, {
              context: agentPiDiagnosticContext(snapshot),
              source: AgentPiDiagnosticSources.Session,
              name: "artifact-index.invalid",
              details: { entryId: artifactIndex.invalidEntryId },
            });
          }
          const toolIndexResult = readAgentPiCompactionToolCallIndex(contextEntries);
          if (toolIndexResult.invalidEntryId && !reportedInvalidToolIndexes.has(toolIndexResult.invalidEntryId)) {
            reportedInvalidToolIndexes.add(toolIndexResult.invalidEntryId);
            await emitAgentPiDiagnostic(snapshot.diagnostics ?? this.options.diagnostics, {
              context: agentPiDiagnosticContext(snapshot),
              source: AgentPiDiagnosticSources.Session,
              name: "compaction-tool-index.invalid",
              details: { entryId: toolIndexResult.invalidEntryId },
            });
          }
          const bridgeResult = compactionSummaryBridge.transform({
            messages: event.messages,
            toolCallIndex: toolIndexResult.index,
          });
          let prepared = snapshot.tokenBudget ? observationProjector.prepare(bridgeResult.messages) : undefined;
          if (digestSession && snapshot.tokenBudget && prepared?.inspection.requiresProjection) {
            const changed = await this.enrichToolObservations({
              digestSession,
              observationProjector,
              messages: bridgeResult.messages,
              inspection: prepared.inspection,
              frame: snapshot,
              tokenBudget: snapshot.tokenBudget,
            });
            if (changed) prepared = observationProjector.prepare(bridgeResult.messages);
          }
          const toolMessages = prepared?.messages ?? bridgeResult.messages;
          return {
            messages: snapshot.tokenBudget
              ? applyAgentPiContextPolicy(
                  toolMessages,
                  snapshot.contextPolicy,
                  artifactIndex.artifacts,
                  snapshot.tokenBudget,
                )
              : toolMessages,
          };
        });
      },
    };
  }

  private async enrichToolObservations(input: {
    digestSession: ReturnType<AgentPiToolObservationDigester["createSession"]>;
    observationProjector: AgentPiToolObservationBatchProjector;
    messages: readonly AgentMessage[];
    inspection: AgentPiToolObservationBatchInspection;
    frame: AgentPiCodingAgentSessionFrame;
    tokenBudget: AgentTurnTokenBudget;
  }): Promise<boolean> {
    const sourceIdentities = input.observationProjector.pendingObservationIdentities(input.messages);
    const objective = input.frame.rootCommand?.objective;
    try {
      const enriched = await input.digestSession.enrich(input.messages, {
        objective,
        targetTokens: Math.min(
          input.tokenBudget.outputReserveTokens,
          Math.max(1, input.inspection.availableTokens - input.inspection.minimumTokens),
        ),
        signal: input.frame.signal,
        sourceIdentities,
      });
      if (input.observationProjector.commitCondensedBatch(enriched, sourceIdentities)) {
        input.digestSession.release(input.messages, { objective, sourceIdentities });
        return true;
      }
      return false;
    } catch (error) {
      await emitAgentPiDiagnostic(input.frame.diagnostics ?? this.options.diagnostics, {
        context: agentPiDiagnosticContext(input.frame),
        source: AgentPiDiagnosticSources.Substrate,
        name: "tool-observation.digest.failed",
        details: { message: errorMessage(error) },
      });
      return false;
    }
  }
}
