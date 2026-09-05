import type { AgentBrowserOperation } from "./AgentBrowserTypes.js";

export type AgentBrowserNetworkRequestKind = "navigation" | "subresource";

export interface AgentBrowserDriverSessionOptions {
  readonly requestTimeoutMs: number;
  readonly maxDownloadBytes: number;
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

export interface AgentBrowserDriverDownload {
  readonly data: Uint8Array;
  readonly fileName: string;
  readonly url: string;
}

export interface AgentBrowserDriverOperationResult {
  readonly content?: string;
  readonly page?: {
    readonly url: string;
    readonly title: string;
  };
  readonly screenshot?: AgentBrowserDriverScreenshot;
  readonly download?: AgentBrowserDriverDownload;
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
