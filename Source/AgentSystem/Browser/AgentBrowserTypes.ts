import type { AgentToolArtifactPayload } from "../Types/ToolRuntimeTypes.js";

export const AgentBrowserOperationNames = [
  "open",
  "read",
  "snapshot",
  "click",
  "fill",
  "type",
  "press",
  "check",
  "uncheck",
  "select",
  "scroll",
  "wait_ms",
  "wait_for_selector",
  "wait_for_text",
  "wait_for_load",
  "screenshot",
  "get_text",
  "get_url",
  "get_title",
  "close",
  "back",
  "forward",
  "reload",
  "tab_new",
  "tab_list",
  "tab_switch",
  "tab_close",
] as const;

export type AgentBrowserOperation = (typeof AgentBrowserOperationNames)[number];

export interface AgentBrowserOperationResult {
  readonly status: "completed";
  readonly summary: string;
  readonly trust: "untrusted_browser_content";
  readonly truncated: boolean;
  readonly content?: string;
  readonly screenshot?: {
    readonly assetId: string;
    readonly mediaType: string;
    readonly markdown: string;
  };
}

export interface AgentBrowserOperationExecution {
  readonly result: AgentBrowserOperationResult;
  readonly artifactPayload: AgentToolArtifactPayload;
}
