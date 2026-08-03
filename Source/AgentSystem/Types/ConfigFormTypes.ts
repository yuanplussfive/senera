export type AgentConfigFormFieldType = "boolean" | "string" | "number" | "array" | "table" | "record";

export type AgentConfigFormFieldOptionValue = string | number | boolean;

export type AgentConfigFormFieldLevel = "basic" | "advanced" | "internal";

export type AgentConfigFormValueSource = "explicit" | "inherited" | "default" | "missing";

export const AgentConfigFormVersion = 1 as const;

export type AgentConfigFormModelCapability =
  "Chat" | "Embedding" | "Rerank" | "Vision" | "ImageOutput" | "Reasoning" | "DeveloperRole" | "StreamingUsage";

export interface AgentConfigFormModelSelection {
  id: string;
  capability: AgentConfigFormModelCapability;
  valueKind: "model-id" | "provider-model";
  mutation: "config" | "default-model";
  providerPath?: string[];
  required: boolean;
}

export interface AgentConfigFormSnapshot {
  version: typeof AgentConfigFormVersion;
  sections: AgentConfigFormSection[];
}

export interface AgentConfigFormSection<TText = string> {
  name: string;
  label: TText;
  description?: TText;
  icon?: string;
  keyCount: number;
  fields: AgentConfigFormField<TText>[];
}

export interface AgentConfigFormField<TText = string> {
  label: TText;
  section: string;
  key: string;
  path: string[];
  type: AgentConfigFormFieldType;
  itemType?: AgentConfigFormFieldType;
  value: unknown;
  effectiveValue: unknown;
  configured: boolean;
  missing: boolean;
  valueSource: AgentConfigFormValueSource;
  description?: TText;
  placeholder?: TText;
  options?: AgentConfigFormFieldOptionValue[];
  optionLabels?: Record<string, string>;
  min?: number;
  max?: number;
  minLength?: number;
  maxLength?: number;
  step?: number;
  secret?: boolean;
  multiline?: boolean;
  required: boolean;
  essential: boolean;
  addLabel?: string;
  itemLabelPath?: string[];
  itemFields?: AgentConfigFormField<TText>[];
  defaultValue?: unknown;
  defaultItem?: Record<string, unknown>;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
  modelSelection?: AgentConfigFormModelSelection;
}
