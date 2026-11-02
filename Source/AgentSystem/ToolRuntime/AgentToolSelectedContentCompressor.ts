import path from "node:path";
import { tmpdir } from "node:os";
import { AgentTokenProjector } from "../Text/AgentTokenProjection.js";
import { throwIfAborted } from "../Core/AgentCancellation.js";
import { AgentToolObservationContentPipeline } from "./AgentToolObservationContentPipeline.js";
import type { AgentToolObservationSummaryRequest } from "./AgentToolResultObservationCompressor.js";

export interface AgentSelectedContentView {
  readonly value: unknown;
  readonly representation: "original" | "summary" | "excerpt";
  readonly method: "verbatim" | "llm" | "mechanical" | "truncated";
  readonly complete: boolean;
  readonly reason?: "llm_summary_failed" | "summary_exceeded_budget" | "mechanical_projection_failed";
}

/** One explicit degradation policy, shared by every selected result source. */
export class AgentToolSelectedContentCompressor {
  private readonly tokens: AgentTokenProjector;
  private readonly mechanical: AgentToolObservationContentPipeline;
  constructor(
    private readonly options: {
      readonly model: string;
      readonly stashDir?: string;
      readonly summarize: (request: AgentToolObservationSummaryRequest) => Promise<string>;
    },
  ) {
    this.tokens = new AgentTokenProjector(options.model);
    this.mechanical = new AgentToolObservationContentPipeline({
      model: options.model,
      stashDir: options.stashDir ?? path.join(tmpdir(), "senera-tool-observation-sift"),
    });
  }

  async compress(
    value: unknown,
    request: Omit<AgentToolObservationSummaryRequest, "feedback">,
  ): Promise<AgentSelectedContentView> {
    throwIfAborted(request.signal);
    if (this.tokens.countJson(value) <= request.tokenBudget) {
      return { value, representation: "original", method: "verbatim", complete: true };
    }
    let reason: AgentSelectedContentView["reason"];
    let source = value;
    let representation: AgentSelectedContentView["representation"] = "excerpt";
    try {
      const summary = (await this.options.summarize({ ...request, feedback: value })).trim();
      throwIfAborted(request.signal);
      if (!summary) throw new Error("Tool-observation compression returned an empty summary.");
      if (this.tokens.countJson(summary) <= request.tokenBudget) {
        return { value: summary, representation: "summary", method: "llm", complete: false };
      }
      source = summary;
      representation = "summary";
      reason = "summary_exceeded_budget";
    } catch {
      throwIfAborted(request.signal);
      reason = "llm_summary_failed";
    }
    try {
      const projected = await this.mechanical.projectValue(source, {
        tokenLimit: request.tokenBudget,
        query: request.currentUserMessage,
        signal: request.signal,
      });
      throwIfAborted(request.signal);
      if (this.tokens.countJson(projected.value) <= request.tokenBudget) {
        return {
          value: projected.value,
          representation,
          method: projected.structuralTruncation ? "truncated" : "mechanical",
          complete: false,
          reason,
        };
      }
      source = projected.value;
    } catch {
      throwIfAborted(request.signal);
      reason = "mechanical_projection_failed";
    }
    return {
      value: this.tokens.projectJson(source, request.tokenBudget).projectedValue,
      representation,
      method: "truncated",
      complete: false,
      reason,
    };
  }
}
