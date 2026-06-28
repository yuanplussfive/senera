import { AgentCancellationError } from "../Core/AgentCancellation.js";
import type { AgentTextBudgetEvaluator, AgentExceededTextBudgetSnapshot } from "../Text/AgentTextBudget.js";
import type { AgentXmlProtocolPolicy } from "../Xml/AgentXmlPolicy.js";
import type { AgentXmlCandidateNormalizer } from "../Xml/AgentToolCallsXmlNormalizer.js";
import type { AgentLanguageModel } from "../ModelEndpoints/AgentLanguageModel.js";
import type { AgentModelProviderMetadata } from "../ModelEndpoints/AgentModelMetadata.js";
import { AgentXmlStreamStates } from "../Xml/AgentXmlStatus.js";
import {
  AgentDecisionXmlStreamAssembler,
  type AgentDecisionXmlStreamSnapshot,
} from "./AgentDecisionXmlStreamAssembler.js";
import type { AgentDecisionXmlCollectRequest } from "./AgentDecisionXmlCollectionTypes.js";
import { AgentDecisionXmlCollectionEvents } from "./AgentDecisionXmlCollectionEvents.js";

export type AgentDecisionXmlStreamCollection =
  | {
      kind: "completed";
      text: string;
      snapshot: AgentDecisionXmlStreamSnapshot;
      modelProvider: AgentModelProviderMetadata;
    }
  | {
      kind: "token_limit";
      text: string;
      snapshot: AgentDecisionXmlStreamSnapshot;
      budget: AgentExceededTextBudgetSnapshot;
      modelProvider: AgentModelProviderMetadata;
    };

export interface AgentDecisionXmlStreamCollectorOptions {
  model: AgentLanguageModel;
  policy: AgentXmlProtocolPolicy;
  textBudget: AgentTextBudgetEvaluator;
  acceptRoot: (rootName: string) => boolean;
  candidateNormalizer?: AgentXmlCandidateNormalizer;
  events: AgentDecisionXmlCollectionEvents;
}

export class AgentDecisionXmlStreamCollector {
  constructor(private readonly options: AgentDecisionXmlStreamCollectorOptions) {}

  async collect(request: AgentDecisionXmlCollectRequest): Promise<AgentDecisionXmlStreamCollection> {
    if (request.signal?.aborted) {
      throw new AgentCancellationError();
    }

    const stream = await this.options.model.stream(request);
    const assembler = new AgentDecisionXmlStreamAssembler({
      policy: this.options.policy,
      acceptRoot: this.options.acceptRoot,
      allowEmbeddedCandidates: false,
      allowFencedEnvelope: false,
      candidateNormalizer: this.options.candidateNormalizer,
    });

    let text = "";
    let toolCallsSnapshot: AgentDecisionXmlStreamSnapshot | undefined;
    const abortListener = (): void => {
      stream.abort();
    };
    request.signal?.addEventListener("abort", abortListener, { once: true });

    try {
      for await (const chunk of stream) {
        const snapshot = assembler.push(chunk.textDelta);
        const budget = this.options.textBudget.measure(snapshot.candidateXml);
        text = snapshot.rawText;

        await this.options.events.emitProgress(request, snapshot);

        if (budget.state === "limit_reached") {
          await this.options.events.emitLimitReached(request, budget);
          stream.abort();
          await this.options.events.emitModelStreamAborted(
            request,
            "decision_xml_token_limit_exceeded",
          );
          await this.options.events.emitModelCompleted(request, text);
          await this.options.events.emitDecisionXmlArtifacts(request, text, {
            sanitized: false,
          });
          return {
            kind: "token_limit",
            text,
            snapshot,
            budget,
            modelProvider: stream.metadata,
          };
        }

        if (snapshot.state === AgentXmlStreamStates.RootClosed) {
          toolCallsSnapshot = snapshot;
        }
      }
    } catch (error) {
      if (request.signal?.aborted) {
        throw new AgentCancellationError();
      }
      throw error;
    } finally {
      request.signal?.removeEventListener("abort", abortListener);
    }

    if (request.signal?.aborted) {
      throw new AgentCancellationError();
    }

    await this.options.events.emitModelCompleted(request, text);
    return {
      kind: "completed",
      text,
      snapshot: toolCallsSnapshot ?? assembler.current(),
      modelProvider: stream.metadata,
    };
  }
}
