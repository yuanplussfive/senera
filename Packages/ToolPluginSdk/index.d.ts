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

/** A host-resolved upload exposed through a declared public tool resource binding. */
export interface McpUploadResource {
  uploadUri: string;
  filePath: string;
  name: string;
  mime: string;
  declaredMime?: string;
  size: number;
  sha256: string;
}

export interface McpToolSuiteOptions {
  serverName?: string;
  serverVersion?: string;
  remoteJobTools?: readonly string[];
  taskStore?: TaskStore;
  taskMessageQueue?: TaskMessageQueue;
  taskEventStore?: TaskEventStore;
}

export type ToolContractJsonSchema = Readonly<Record<string, unknown>>;

export interface ToolContractBundleOptions {
  /** Stable package or source identity. The tool name is appended to keep each contract independently traceable. */
  sourceIdentity?: string;
  /** Optional authoring file path included for diagnostics only. */
  sourceFile?: string;
}

export interface ToolContractBundleDefinition {
  readonly source: {
    readonly kind: "schema";
    readonly identity: string;
    readonly file?: string;
    readonly sha256: string;
  };
  readonly inputSchema: ToolContractJsonSchema;
  readonly outputSchema: ToolContractJsonSchema;
}

export interface ToolContractBundle {
  readonly contractVersion: typeof ToolContractVersion;
  readonly tools: Readonly<Record<string, ToolContractBundleDefinition>>;
}

export interface ReadPluginTomlConfigOptions {
  cwd?: string;
  exampleFileName?: string;
}

export type PluginConfigurationFieldType = "boolean" | "string" | "number" | "array" | "table";

export interface PluginConfigurationField {
  path: readonly string[];
  label: string;
  type: PluginConfigurationFieldType;
  description?: string;
  placeholder?: string;
  itemType?: Exclude<PluginConfigurationFieldType, "array">;
  options?: readonly (string | number | boolean)[];
  optionLabels?: Readonly<Record<string, string>>;
  min?: number;
  max?: number;
  step?: number;
  secret?: boolean;
  multiline?: boolean;
  required: boolean;
  essential: boolean;
}

export interface PluginConfigurationSection {
  id: string;
  label: string;
  description?: string;
  level?: "internal";
  fields: readonly PluginConfigurationField[];
}

export interface PluginConfigurationDefinition<TConfig> {
  schema: z.ZodType<TConfig>;
  defaults: TConfig;
  form: {
    version?: 1;
    strict?: boolean;
    sections: readonly PluginConfigurationSection[];
    allowedPaths?: readonly { path: readonly string[]; recursive?: boolean }[];
  };
}

export interface PluginConfiguration<TConfig> {
  readonly schema: z.ZodType<TConfig>;
  readonly defaults: TConfig;
  readonly form: Required<Pick<PluginConfigurationDefinition<TConfig>["form"], "sections">> & {
    version: 1;
    strict: boolean;
    allowedPaths?: readonly { path: readonly string[]; recursive?: boolean }[];
  };
}

export interface PluginConfigurationArtifacts {
  readonly schemaToml: string;
  readonly exampleToml: string;
}

export function runMcpTool<TArguments, TResult>(definition: McpToolDefinition<TArguments, TResult>): Promise<void>;
export const ToolContractVersion: 1;
export function createToolContractBundle(
  definitions: readonly McpToolDefinition[],
  options?: ToolContractBundleOptions,
): ToolContractBundle;
export function definePluginConfiguration<TConfig>(
  definition: PluginConfigurationDefinition<TConfig>,
): PluginConfiguration<TConfig>;
export function createPluginConfigurationArtifacts<TConfig>(
  configuration: PluginConfigurationDefinition<TConfig> | PluginConfiguration<TConfig>,
): PluginConfigurationArtifacts;
export function runMcpToolSuite(
  definitions: readonly McpToolDefinition[],
  options?: McpToolSuiteOptions,
): Promise<void>;
export function parsePluginTomlConfig(content: string): Record<string, unknown>;
export function readPluginTomlConfig(fileName?: string, options?: ReadPluginTomlConfigOptions): Record<string, unknown>;
export function resolvePluginConfigPath(fileName?: string, options?: { cwd?: string }): string;

export { z, ZodError };
