import type { RunActivity } from "../../api/generatedEventCatalog";
import type { ToolEventOrigin } from "../../api/eventTypes";
import type { TimelineStepKind } from "../../store/sessionStore";

export const RuntimeDiagnosticLanes = {
  Context: "context",
  Runtime: "runtime",
  Model: "model",
  Tools: "tools",
  Response: "response",
} as const;

export type RuntimeDiagnosticLane = (typeof RuntimeDiagnosticLanes)[keyof typeof RuntimeDiagnosticLanes];

export const RuntimeDiagnosticLaneOrder: readonly RuntimeDiagnosticLane[] = [
  RuntimeDiagnosticLanes.Context,
  RuntimeDiagnosticLanes.Runtime,
  RuntimeDiagnosticLanes.Model,
  RuntimeDiagnosticLanes.Tools,
  RuntimeDiagnosticLanes.Response,
];

export type RuntimeDiagnosticSpanStatus = "running" | "completed" | "failed" | "cancelled";
export type RuntimeDiagnosticSpanSource = "activity" | "tool" | "step";

export interface RuntimeDiagnosticSpan {
  readonly id: string;
  readonly source: RuntimeDiagnosticSpanSource;
  readonly lane: RuntimeDiagnosticLane;
  readonly kind?: TimelineStepKind;
  /** Original journal kind when the span comes from the session-wide event stream. */
  readonly eventKind?: string;
  /** Source-local sequence retained for diagnostics; it is not a global timeline clock. */
  readonly eventSequence?: number;
  readonly description?: string;
  readonly purpose?: string;
  readonly isThinking?: boolean;
  readonly status: RuntimeDiagnosticSpanStatus;
  readonly operation?: RunActivity;
  readonly label?: string;
  readonly modelName?: string;
  readonly responseModel?: string;
  readonly toolName?: string;
  readonly toolOrigin?: ToolEventOrigin;
  readonly toolArguments?: unknown;
  readonly toolResult?: unknown;
  readonly toolPresentation?: import("../../api/eventTypes").ToolResultPresentation;
  readonly toolPreview?: string;
  readonly toolErrorMessage?: string;
  readonly callId?: string;
  readonly requestId: string;
  readonly step?: number;
  readonly startedAt: string;
  readonly startedAtEpoch: number;
  readonly endedAtEpoch?: number;
  readonly durationMs?: number;
  readonly track?: number;
}

export interface RuntimeDiagnosticLaneModel {
  readonly lane: RuntimeDiagnosticLane;
  readonly spans: readonly RuntimeDiagnosticSpan[];
  readonly trackCount: number;
}

export interface RuntimeDiagnosticModel {
  readonly requestId?: string;
  readonly sessionId?: string;
  readonly spans: readonly RuntimeDiagnosticSpan[];
  readonly lanes: readonly RuntimeDiagnosticLaneModel[];
  readonly startedAtEpoch?: number;
  readonly endAtEpoch?: number;
  readonly nowEpoch: number;
  readonly current?: RuntimeDiagnosticSpan;
  readonly connection: RuntimeDiagnosticHealth;
  readonly contextUsage?: RuntimeContextUsage;
  readonly sessionUsage?: RuntimeSessionUsage;
}

export interface RuntimeContextUsage {
  readonly tokens: number | null;
  readonly contextWindow: number;
  readonly percent: number | null;
}

export interface RuntimeSessionUsage {
  readonly userMessages: number;
  readonly assistantMessages: number;
  readonly toolCalls: number;
  readonly toolResults: number;
  readonly totalMessages: number;
  readonly tokens: {
    readonly input: number;
    readonly output: number;
    readonly cacheRead: number;
    readonly cacheWrite: number;
    readonly total: number;
  };
  readonly cost?: number;
}

export interface RuntimeUsageSnapshot {
  readonly contextUsage?: RuntimeContextUsage;
  readonly sessionUsage?: RuntimeSessionUsage;
}

export type RuntimeDiagnosticHealth = "healthy" | "active" | "failed" | "cancelled" | "unknown";
