import type {
  AgentConfigFormInputBounds,
  AgentConfigFormFieldPresence,
} from "../../../Source/AgentSystem/Types/ConfigFormTypes";

export type ConfigFormFieldType = "boolean" | "string" | "number" | "array" | "table" | "record";

export type ConfigFormFieldOptionValue = string | number | boolean;

export interface ConfigFormVisibilityCondition {
  path: string[];
  equals?: ConfigFormFieldOptionValue;
  in?: ConfigFormFieldOptionValue[];
}

export type ConfigFormValueSource = "explicit" | "inherited" | "default" | "missing";

export type ConfigFormModelCapability =
  import("../../../Source/AgentSystem/Types/ConfigFormTypes").AgentConfigFormModelCapability;

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
  documentation?: TText;
  icon?: string;
  keyCount: number;
  fields: ConfigFormFieldData<TText>[];
}

export interface ConfigFormFieldData<TText = string> extends AgentConfigFormInputBounds, AgentConfigFormFieldPresence {
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
  step?: number;
  durationUnit?: import("../../../Source/AgentSystem/Types/AgentDurationUnits").AgentDurationUnit;
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
  /** Local model presentation, populated from the configured model catalog. */
  modelOptions?: { value: string; label: string; description?: string; icon?: string }[];
  visibleWhen?: ConfigFormVisibilityCondition;
}
