export type ConfigFormFieldType = "boolean" | "string" | "number" | "array" | "table" | "record";

export type ConfigFormFieldOptionValue = string | number | boolean;

export interface ConfigFormVisibilityCondition {
  path: string[];
  equals?: ConfigFormFieldOptionValue;
  in?: ConfigFormFieldOptionValue[];
}

export type ConfigFormValueSource = "explicit" | "inherited" | "default" | "missing";

export type ConfigFormModelCapability =
  "Chat" | "Vision" | "ImageOutput" | "Reasoning" | "ToolCalling" | "DeveloperRole" | "StreamingUsage";

export interface ConfigFormModelSelectionData {
  id: string;
  capability: ConfigFormModelCapability;
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

export interface ConfigFormSnapshotData {
  version: 1;
  sections: ConfigFormSectionData[];
}

export interface ConfigFormSectionData<TText = string> {
  name: string;
  label: TText;
  description?: TText;
  icon?: string;
  keyCount: number;
  fields: ConfigFormFieldData<TText>[];
}

export interface ConfigFormFieldData<TText = string> {
  label: TText;
  section: string;
  key: string;
  path: string[];
  type: ConfigFormFieldType;
  itemType?: ConfigFormFieldType;
  value: unknown;
  effectiveValue: unknown;
  configured: boolean;
  missing: boolean;
  valueSource: ConfigFormValueSource;
  description?: TText;
  placeholder?: TText;
  options?: ConfigFormFieldOptionValue[];
  optionLabels?: Record<string, TText>;
  optionSource?: {
    catalog: "skills";
  };
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
  itemFields?: ConfigFormFieldData<TText>[];
  defaultValue?: unknown;
  defaultItem?: Record<string, unknown>;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
  modelSelection?: ConfigFormModelSelectionData;
  visibleWhen?: ConfigFormVisibilityCondition;
}
