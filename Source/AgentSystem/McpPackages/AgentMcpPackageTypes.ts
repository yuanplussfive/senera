import type { AgentSourceDiagnostic } from "../Diagnostics/AgentSourceDiagnostic.js";
import type { AgentMcpExecution } from "./AgentMcpPackageSchema.js";
import type { AgentMcpHostRequirements } from "./AgentMcpHostRequirements.js";
import { AgentBaseError } from "../Core/AgentBaseError.js";
import type { AgentExtensionValueExpression } from "../Extensions/AgentExtensionValueExpression.js";
import type { AgentMcpInputDefinition } from "./AgentMcpInputDefinition.js";
import type { AgentExtensionLocalizedText } from "../Extensions/AgentExtensionLocalization.js";

export const AgentMcpPackageSourceKinds = {
  Bundled: "bundled",
  Workspace: "workspace",
} as const;

export type AgentMcpPackageSourceKind = (typeof AgentMcpPackageSourceKinds)[keyof typeof AgentMcpPackageSourceKinds];

export const AgentMcpServerRuntimes = {
  Node: "node",
} as const;

export type AgentMcpServerRuntime = (typeof AgentMcpServerRuntimes)[keyof typeof AgentMcpServerRuntimes];

export interface AgentMcpPackage {
  readonly rootPath: string;
  readonly configurationPath: string;
  readonly revision: string;
  readonly name: string;
  readonly displayName?: AgentExtensionLocalizedText;
  readonly description?: AgentExtensionLocalizedText;
  readonly source: AgentMcpPackageSourceKind;
  readonly descriptorKind: "mcpb" | "registry" | "legacy" | "connection";
  readonly execution?: AgentMcpExecution;
  readonly requirements?: AgentMcpHostRequirements;
  readonly servers: readonly AgentMcpPackageServer[];
}

/**
 * Search aliases declared for MCP tools by the package manifest. Keys are the
 * remote tool's local `declaration.name`; values are localized search terms
 * (Chinese-first) that make the tool retrievable when the protocol description
 * is English-only. Read only from the package manifest's
 * `_meta.ai.senera/tool-i18n` declaration; runtime `tools/list` metadata is not
 * a localization source.
 */
export type AgentMcpPackageToolLocalization = Readonly<Record<string, readonly string[]>>;

export interface AgentMcpPackageServer {
  readonly name: string;
  readonly configuration: AgentMcpServerConfiguration;
  readonly inputs: readonly AgentMcpInputDefinition[];
  readonly toolLocalization?: AgentMcpPackageToolLocalization;
}

export interface AgentMcpStdioServerConfiguration {
  readonly type: "stdio";
  /** A host-managed runtime hint. The command remains the portable fallback. */
  readonly runtime?: AgentMcpServerRuntime;
  readonly command: AgentExtensionValueExpression;
  readonly args: readonly AgentExtensionValueExpression[];
  readonly cwd: AgentExtensionValueExpression;
  readonly env?: Readonly<Record<string, AgentExtensionValueExpression>>;
}

export interface AgentMcpHttpServerConfiguration {
  readonly type: "http";
  readonly url: AgentExtensionValueExpression;
  readonly headers?: Readonly<Record<string, AgentExtensionValueExpression>>;
}

export type AgentMcpServerConfiguration = AgentMcpStdioServerConfiguration | AgentMcpHttpServerConfiguration;

interface AgentMcpRuntimeEndpointBase {
  readonly id: string;
  readonly revision: string;
  readonly packageName?: string;
  readonly packageRoot?: string;
}

export interface AgentMcpStdioRuntimeEndpoint extends AgentMcpRuntimeEndpointBase {
  readonly transport?: "stdio";
  readonly runtime?: AgentMcpServerRuntime;
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env?: Readonly<Record<string, string>>;
}

export interface AgentMcpHttpRuntimeEndpoint extends AgentMcpRuntimeEndpointBase {
  readonly transport: "http";
  readonly url: string;
  readonly headers?: Readonly<Record<string, string>>;
}

export type AgentMcpRuntimeEndpoint = AgentMcpStdioRuntimeEndpoint | AgentMcpHttpRuntimeEndpoint;

export class AgentMcpPackageValidationError extends AgentBaseError {
  constructor(
    message: string,
    readonly diagnostics: readonly AgentSourceDiagnostic[],
  ) {
    super(message);
  }
}
