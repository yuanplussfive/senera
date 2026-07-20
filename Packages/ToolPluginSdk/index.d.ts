import type { TaskMessageQueue, TaskStore } from "@modelcontextprotocol/sdk/experimental/tasks";
import { z, ZodError } from "zod";
import type { TaskEventStore, ToolOutput } from "./protocol";

export interface ToolProgress {
  completed: number;
  total?: number;
  message?: string;
}

export interface McpToolContext {
  workspaceRoot?: string;
  pluginRoot?: string;
  sessionId?: string;
  requestId?: string;
  step?: number;
  toolCallId?: string;
  batchId?: string;
  taskId?: string;
  signal: AbortSignal;
  reportProgress(progress: ToolProgress): Promise<boolean>;
  /**
   * Emits a textual tool stream. Senera delivers it live when enabled and
   * captures it into the tool artifact spool independently of live delivery.
   */
  reportOutput(output: ToolOutput): Promise<boolean>;
}

export interface McpToolDefinition<TArguments = unknown, TResult = unknown> {
  toolName: string;
  description?: string;
  argumentSchema: z.ZodType<TArguments>;
  resultSchema: z.ZodType<TResult>;
  /** Projects a concise model-visible message without serializing the complete structured result twice. */
  resultText?(result: TResult): string;
  execute(arguments_: TArguments, context: McpToolContext): TResult | Promise<TResult>;
}

export interface McpToolSuiteOptions {
  serverName?: string;
  serverVersion?: string;
  remoteJobTools?: readonly string[];
  taskStore?: TaskStore;
  taskMessageQueue?: TaskMessageQueue;
  taskEventStore?: TaskEventStore;
}

export interface ReadPluginTomlConfigOptions {
  cwd?: string;
  exampleFileName?: string;
}

export function runMcpTool<TArguments, TResult>(definition: McpToolDefinition<TArguments, TResult>): Promise<void>;
export function runMcpToolSuite(
  definitions: readonly McpToolDefinition[],
  options?: McpToolSuiteOptions,
): Promise<void>;
export function parsePluginTomlConfig(content: string): Record<string, unknown>;
export function readPluginTomlConfig(fileName?: string, options?: ReadPluginTomlConfigOptions): Record<string, unknown>;
export function resolvePluginConfigPath(fileName?: string, options?: { cwd?: string }): string;

export { z, ZodError };
