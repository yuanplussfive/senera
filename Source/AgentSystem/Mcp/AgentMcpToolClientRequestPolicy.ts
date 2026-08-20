import type { RequestOptions } from "@modelcontextprotocol/sdk/shared/protocol.js";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import type { AgentMcpToolCallOptions, AgentMcpToolClientOptions } from "./AgentMcpToolClientContracts.js";

export function agentMcpRequestOptions(
  options: AgentMcpToolClientOptions,
  call: AgentMcpToolCallOptions = {},
): RequestOptions {
  const transientProgress = call.resumableEvents ? undefined : call.onProgress;
  return {
    signal: call.signal ?? options.signal,
    timeout: options.requestTimeoutMs,
    maxTotalTimeout: options.requestTimeoutMs,
    resetTimeoutOnProgress: Boolean(transientProgress),
    onprogress: transientProgress,
  };
}

export function agentMcpTaskControlOptions(
  options: AgentMcpToolClientOptions,
  signal?: AbortSignal,
  deadline?: number,
): RequestOptions {
  const timeout = deadline === undefined ? options.requestTimeoutMs : Math.max(1, deadline - Date.now());
  return { signal, timeout, maxTotalTimeout: timeout };
}

export function agentMcpRequestDeadline(options: AgentMcpToolClientOptions): number {
  return Date.now() + options.requestTimeoutMs;
}

export function preferAgentMcpConnectionFailure(error: unknown, failure: Error | undefined): unknown {
  return failure && error instanceof McpError && error.code === ErrorCode.ConnectionClosed ? failure : error;
}
