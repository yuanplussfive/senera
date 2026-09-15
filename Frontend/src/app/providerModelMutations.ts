import type {
  ProviderModelConfigInput,
  ProviderModelConfigOperationKind,
  ProviderModelConfigCommandDraft as ProviderModelCommandDraft,
  ProviderModelGroupAssignmentInput,
} from "../api/providerModelCommandTypes";

export type ProviderModelOperationKind = Extract<
  ProviderModelConfigOperationKind,
  "provider.model.upsert" | "provider.model.delete" | "provider.defaultModel.set"
>;

export type ProviderModelConfigRequest = Extract<
  ProviderModelCommandDraft,
  {
    type: ProviderModelOperationKind;
  }
>;

export function isProviderModelOperationKind(value: unknown): value is ProviderModelOperationKind {
  return (
    value === "provider.model.upsert" || value === "provider.model.delete" || value === "provider.defaultModel.set"
  );
}

export type ProviderModelUpsertInput = {
  model: ProviderModelConfigInput;
  group?: ProviderModelGroupAssignmentInput;
};

export type ProviderModelDeleteInput = {
  modelId: string;
  replacementDefaultModelId?: string;
};
