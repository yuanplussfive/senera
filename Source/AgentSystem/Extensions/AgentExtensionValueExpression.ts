import type { AgentExtensionInputValue } from "./AgentExtensionInput.js";

export const AgentExtensionBindingSources = {
  Secret: "secret",
  Config: "config",
  Oauth: "oauth",
  Runtime: "runtime",
  HostEnvironment: "hostEnvironment",
  LegacyEnvironment: "legacyEnvironment",
} as const;

export type AgentExtensionValueBinding =
  | { readonly source: "secret" | "config" | "oauth"; readonly inputId: string }
  | { readonly source: "runtime"; readonly key: "packageRoot" | "workspaceRoot" }
  | { readonly source: "hostEnvironment" | "legacyEnvironment"; readonly name: string; readonly inputId?: string };

export type AgentExtensionValueExpressionSegment =
  | { readonly kind: "literal"; readonly value: string }
  | {
      readonly kind: "binding";
      readonly binding: AgentExtensionValueBinding;
      readonly defaultValue?: AgentExtensionInputValue;
    };

export interface AgentExtensionValueExpression {
  readonly segments: readonly AgentExtensionValueExpressionSegment[];
}

export interface AgentExtensionValueResolution {
  readonly value: AgentExtensionInputValue;
  readonly source: "vault" | "configuration" | "environment" | "oauth";
  readonly updatedAt?: string;
}

export interface AgentExtensionValueResolver {
  resolve(serverId: string, binding: AgentExtensionValueBinding): AgentExtensionValueResolution | undefined;
}

export function fixedAgentExtensionValue(value: string): AgentExtensionValueExpression {
  return { segments: value ? [{ kind: "literal", value }] : [] };
}

export function boundAgentExtensionValue(binding: AgentExtensionValueBinding): AgentExtensionValueExpression {
  return { segments: [{ kind: "binding", binding }] };
}
