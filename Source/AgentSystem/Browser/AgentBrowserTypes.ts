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
  "download",
  "computer",
] as const;

export type AgentBrowserOperation = (typeof AgentBrowserOperationNames)[number];

export const AgentBrowserComputerActionTypes = [
  "click",
  "double_click",
  "move",
  "scroll",
  "drag",
  "type",
  "keypress",
  "wait",
  "screenshot",
] as const;

export type AgentBrowserComputerActionType = (typeof AgentBrowserComputerActionTypes)[number];

export interface AgentBrowserPoint {
  readonly x: number;
  readonly y: number;
}

export type AgentBrowserComputerAction =
  | {
      readonly type: "click" | "double_click";
      readonly x: number;
      readonly y: number;
      readonly button?: "left" | "middle" | "right";
      readonly modifiers?: readonly string[];
    }
  | {
      readonly type: "move";
      readonly x: number;
      readonly y: number;
      readonly modifiers?: readonly string[];
    }
  | {
      readonly type: "scroll";
      readonly x: number;
      readonly y: number;
      readonly scrollX?: number;
      readonly scrollY?: number;
      readonly modifiers?: readonly string[];
    }
  | {
      readonly type: "drag";
      readonly path: readonly AgentBrowserPoint[];
      readonly modifiers?: readonly string[];
    }
  | { readonly type: "type"; readonly text: string }
  | { readonly type: "keypress"; readonly keys: readonly string[] }
  | { readonly type: "wait"; readonly ms: number }
  | { readonly type: "screenshot" };

export interface AgentBrowserOperationResult {
  readonly status: "completed";
  readonly summary: string;
  readonly trust: "untrusted_browser_content";
  readonly truncated: boolean;
  readonly content?: string;
  readonly page?: {
    readonly url: string;
    readonly title: string;
  };
  readonly screenshot?: {
    readonly assetId: string;
    readonly mediaType: string;
    readonly markdown: string;
  };
  readonly download?: {
    readonly assetId: string;
    readonly fileName: string;
    readonly mediaType: string;
    readonly markdown: string;
  };
}

export interface AgentBrowserOperationExecution {
  readonly result: AgentBrowserOperationResult;
  readonly artifactPayload: AgentToolArtifactPayload;
}
