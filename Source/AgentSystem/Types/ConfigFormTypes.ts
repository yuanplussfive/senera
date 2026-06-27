export type AgentConfigFormFieldType =
  | "boolean"
  | "string"
  | "number"
  | "array"
  | "table"
  | "record";

export type AgentConfigFormFieldOptionValue = string | number | boolean;

export type AgentConfigFormFieldLevel =
  | "basic"
  | "advanced"
  | "internal";

export interface AgentConfigFormSnapshot {
  version: 1;
  sections: AgentConfigFormSection[];
}

export interface AgentConfigFormSection {
  name: string;
  label: string;
  description?: string;
  icon?: string;
  keyCount: number;
  fields: AgentConfigFormField[];
}

export interface AgentConfigFormField {
  label: string;
  section: string;
  key: string;
  path: string[];
  type: AgentConfigFormFieldType;
  itemType?: AgentConfigFormFieldType;
  value: unknown;
  effectiveValue: unknown;
  configured: boolean;
  description?: string;
  placeholder?: string;
  options?: AgentConfigFormFieldOptionValue[];
  optionLabels?: Record<string, string>;
  min?: number;
  max?: number;
  minLength?: number;
  maxLength?: number;
  step?: number;
  secret?: boolean;
  multiline?: boolean;
  required?: boolean;
  addLabel?: string;
  itemLabelPath?: string[];
  itemFields?: AgentConfigFormField[];
  defaultValue?: unknown;
  defaultItem?: Record<string, unknown>;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
}
