export type AgentConfigFormFieldType = "boolean" | "string" | "number" | "array" | "table" | "record";

export type AgentConfigFormFieldOptionValue = string | number | boolean;

export interface AgentConfigFormVisibilityCondition {
  path: string[];
  equals?: AgentConfigFormFieldOptionValue;
  in?: AgentConfigFormFieldOptionValue[];
}

export type AgentConfigFormFieldLevel = "basic" | "advanced" | "internal";

export type AgentConfigFormValueSource = "explicit" | "inherited" | "default" | "missing";

export const AgentConfigFormOptionCatalogs = {
  Skills: "skills",
} as const;

export type AgentConfigFormOptionCatalog =
  (typeof AgentConfigFormOptionCatalogs)[keyof typeof AgentConfigFormOptionCatalogs];

export interface AgentConfigFormOptionSource {
  catalog: AgentConfigFormOptionCatalog;
}

export const AgentConfigFormVersion = 1 as const;

export const AgentConfigFormModelCapabilities = [
  "Chat",
  "Vision",
  "ImageOutput",
  "Reasoning",
  "ToolCalling",
  "DeveloperRole",
  "StreamingUsage",
] as const;
export type AgentConfigFormModelCapability = (typeof AgentConfigFormModelCapabilities)[number];

export interface AgentConfigFormModelSelection {
  id: string;
  capability: AgentConfigFormModelCapability;
  valueKind: "model-id";
  mutation: "config" | "default-model";
  presentation?: "assignment" | "inline";
  cardinality?: "one" | "many";
  inheritance?: {
    source: "parent-model" | "default-model";
    path?: string[];
  };
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
  documentation?: TText;
  icon?: string;
  keyCount: number;
  fields: AgentConfigFormField<TText>[];
}

export interface AgentConfigFormInputBounds {
  readonly min?: number;
  readonly max?: number;
  readonly minExclusive?: boolean;
  readonly maxExclusive?: boolean;
  readonly minLength?: number;
  readonly maxLength?: number;
}

export interface AgentConfigFormFieldPresence {
  /** Optional object ancestors, derived from the schema. Absent objects do not require their children. */
  readonly optionalParents?: readonly (readonly string[])[];
}

export interface AgentConfigFormField<TText = string> extends AgentConfigFormInputBounds, AgentConfigFormFieldPresence {
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
  optionLabels?: Record<string, TText>;
  optionSource?: AgentConfigFormOptionSource;
  step?: number;
  durationUnit?: import("./AgentDurationUnits.js").AgentDurationUnit;
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
  visibleWhen?: AgentConfigFormVisibilityCondition;
}
