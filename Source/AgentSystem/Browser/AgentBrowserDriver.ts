import type { AgentBrowserOperation } from "./AgentBrowserTypes.js";

export type AgentBrowserNetworkRequestKind = "navigation" | "subresource";

export interface AgentBrowserDriverSessionOptions {
  readonly requestTimeoutMs: number;
  readonly assertRequestPermitted: (url: string, kind: AgentBrowserNetworkRequestKind) => Promise<void>;
}

export interface AgentBrowserDriverOperationOptions {
  readonly timeoutMs: number;
  readonly signal?: AbortSignal;
}

export interface AgentBrowserDriverScreenshot {
  readonly data: Uint8Array;
  readonly mediaType: "image/png" | "image/jpeg";
}

export interface AgentBrowserDriverOperationResult {
  readonly content?: string;
  readonly screenshot?: AgentBrowserDriverScreenshot;
}

export interface AgentBrowserDriverSession {
  execute(
    operation: AgentBrowserOperation,
    input: Readonly<Record<string, unknown>>,
    options: AgentBrowserDriverOperationOptions,
  ): Promise<AgentBrowserDriverOperationResult>;
  close(): Promise<void>;
}

export interface AgentBrowserDriver {
  createSession(options: AgentBrowserDriverSessionOptions): Promise<AgentBrowserDriverSession>;
  close(): Promise<void>;
}
