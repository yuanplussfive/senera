import type {
  AgentWebDocumentSignals,
  AgentWebRenderDecision,
  AgentWebRenderStrategy,
} from "./AgentWebDynamicPolicy.js";

export interface AgentWebRenderDiagnostics {
  readonly strategy: AgentWebRenderStrategy;
  readonly decision: AgentWebRenderDecision;
  readonly usedBrowser: boolean;
  readonly browserContentChanged: boolean;
  readonly browserOutputTruncated: boolean;
  readonly score: number;
  readonly reasons: readonly string[];
  readonly signals: AgentWebDocumentSignals;
}
