import type { AgentSourceDiagnostic } from "../Diagnostics/AgentSourceDiagnostic.js";
import type { AgentMcpExecution } from "./AgentMcpPackageSchema.js";
import { AgentBaseError } from "../Core/AgentBaseError.js";
import type { AgentExtensionValueExpression } from "../Extensions/AgentExtensionValueExpression.js";
import type { AgentMcpInputDefinition } from "./AgentMcpInputDefinition.js";

export const AgentMcpPackageSourceKinds = {
  Bundled: "bundled",
  Workspace: "workspace",
} as const;

export type AgentMcpPackageSourceKind = (typeof AgentMcpPackageSourceKinds)[keyof typeof AgentMcpPackageSourceKinds];

export interface AgentMcpPackage {
  readonly rootPath: string;
  readonly configurationPath: string;
  readonly revision: string;
  readonly name: string;
  readonly source: AgentMcpPackageSourceKind;
  readonly descriptorKind: "mcpb" | "registry" | "legacy" | "connection";
  readonly execution?: AgentMcpExecution;
  readonly servers: readonly AgentMcpPackageServer[];
}

export interface AgentMcpPackageServer {
  readonly name: string;
  readonly configuration: AgentMcpServerConfiguration;
  readonly inputs: readonly AgentMcpInputDefinition[];
}

export interface AgentMcpStdioServerConfiguration {
  readonly type: "stdio";
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
