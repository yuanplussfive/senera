import { createOpaqueId } from "../Core/AgentIds.js";
import type { AgentEventSink } from "../Events/AgentEvent.js";
import type { AgentModelUsageLedger } from "../ModelEndpoints/AgentModelUsage.js";
import type { AgentInteractionRouteResult } from "../ActionPlanner/AgentInteractionRouter.js";
import type { AgentRootCommand } from "../AgentRootCommand.js";
import type { TurnUnderstanding } from "../BamlClient/baml_client/types.js";
import type { ExecutedToolCallResult } from "../Types/ToolRuntimeTypes.js";
import type { AgentPiPreparedActionLeasePort } from "./AgentPiPreparedActionLease.js";
import type { AgentPiDiagnosticSink } from "../Pi/AgentPiDiagnostics.js";

export const AgentPiProxyContextHeader = "x-senera-pi-context-id";
export const AgentPiProxyModelProviderHeader = "x-senera-model-provider-id";

export function encodePiProxyModelProviderHeaderValue(modelProviderId: string): string {
  return encodeURIComponent(modelProviderId);
}

export function decodePiProxyModelProviderHeaderValue(headerValue: string): string {
  try {
    return decodeURIComponent(headerValue);
  } catch {
    return headerValue;
  }
}

export interface AgentPiProxyRuntimeContext {
  sessionId?: string;
  requestId?: string;
  step?: number;
  onEvent?: AgentEventSink;
  diagnostics?: AgentPiDiagnosticSink;
  rootCommand?: AgentRootCommand;
  interactionRoute?: AgentInteractionRouteResult;
  turnUnderstanding?: TurnUnderstanding;
  activeSkills?: unknown[];
  toolBatchIdsByCallId?: Map<string, string>;
  executedToolResultsByCallId?: Map<string, ExecutedToolCallResult>;
  usageLedger?: AgentModelUsageLedger;
  preparedAction?: AgentPiPreparedActionLeasePort;
}

const contexts = new Map<string, AgentPiProxyRuntimeContext>();

export function registerPiProxyRuntimeContext(context: AgentPiProxyRuntimeContext): string {
  const id = createOpaqueId("pictx");
  contexts.set(id, context);
  return id;
}

export function readPiProxyRuntimeContext(id: string | undefined): AgentPiProxyRuntimeContext | undefined {
  return id ? contexts.get(id) : undefined;
}

export function registerPiProxyToolCallBatch(
  context: AgentPiProxyRuntimeContext | undefined,
  batchId: string,
  callIds: readonly string[],
): void {
  if (!context || callIds.length === 0) {
    return;
  }

  const batches = context.toolBatchIdsByCallId ?? new Map<string, string>();
  for (const callId of callIds) {
    batches.set(callId, batchId);
  }
  context.toolBatchIdsByCallId = batches;
}

export function readPiProxyToolCallBatchId(
  contextId: string | undefined,
  callId: string | undefined,
): string | undefined {
  if (!contextId || !callId) {
    return undefined;
  }

  return contexts.get(contextId)?.toolBatchIdsByCallId?.get(callId);
}

export function registerPiProxyExecutedToolResult(
  contextId: string | undefined,
  callId: string,
  result: ExecutedToolCallResult,
): void {
  const context = readPiProxyRuntimeContext(contextId);
  if (!context) return;

  const results = context.executedToolResultsByCallId ?? new Map<string, ExecutedToolCallResult>();
  results.set(callId, result);
  context.executedToolResultsByCallId = results;
}

export function takePiProxyExecutedToolResult(
  contextId: string | undefined,
  callId: string,
): ExecutedToolCallResult | undefined {
  const results = readPiProxyRuntimeContext(contextId)?.executedToolResultsByCallId;
  const result = results?.get(callId);
  results?.delete(callId);
  return result;
}

export function releasePiProxyRuntimeContext(id: string | undefined): void {
  if (id) {
    contexts.delete(id);
  }
}

export async function withPiProxyRuntimeContext<T>(
  context: AgentPiProxyRuntimeContext,
  run: (id: string) => Promise<T> | T,
): Promise<T> {
  const id = registerPiProxyRuntimeContext(context);
  try {
    return await run(id);
  } finally {
    releasePiProxyRuntimeContext(id);
  }
}
