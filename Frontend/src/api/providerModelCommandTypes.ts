import type { ModelCapabilitiesData } from "./eventTypes";

export interface ProviderModelEndpointInput {
  Id: string;
  Icon?: string;
  Enabled?: boolean;
  Kind?: "OpenAICompatible";
  BaseUrl?: string;
  ApiKey?: string;
  ApiVersion?: string;
  Headers?: Record<string, string>;
}

export type ProviderModelEndpointPatchInput = Pick<ProviderModelEndpointInput, "Id"> & {
  [Key in Exclude<keyof ProviderModelEndpointInput, "Id">]?: ProviderModelEndpointInput[Key] | null;
};

export type ProviderModelEndpointKind = "Responses" | "ChatCompletions" | "ClaudeMessages" | "GoogleGenerateContent";

export interface ProviderModelConfigInput {
  Id: string;
  ProviderId: string;
  Icon?: string;
  Capabilities?: ModelCapabilitiesData;
  ContextWindowTokens?: number;
  MaxModelOutputTokens?: number;
  Endpoint: ProviderModelEndpointKind;
  Model: string;
  Temperature?: number;
  MaxOutputTokens?: number;
  Stream?: boolean;
  TimeoutSeconds?: number;
  FirstTokenTimeoutSeconds?: number;
  MaxRequestSeconds?: number;
  MaxNetworkRetries?: number;
  RetryBaseDelaySeconds?: number;
  RetryMaxDelaySeconds?: number;
  RetryAfterMaxDelaySeconds?: number;
}

export interface ProviderModelGroupAssignmentInput {
  groupId: string;
  label?: string;
  icon?: string;
}

export interface ProviderModelBulkImportGroupAssignmentInput extends ProviderModelGroupAssignmentInput {
  modelId: string;
}

export interface ConfigRevisionGuardRequestInput {
  commandId: string;
  baseRevision?: number;
  baseVersion?: number;
}

export interface ConfigCommandRequestInput {
  commandId: string;
}

export type ProviderModelConfigOperationKind =
  | "provider.endpoint.upsert"
  | "provider.endpoint.delete"
  | "provider.endpoint.rename"
  | "provider.model.upsert"
  | "provider.model.delete"
  | "provider.model.bulkImport"
  | "provider.defaultModel.set";

export type ProviderModelConfigRequest =
  | (ConfigCommandRequestInput & { type: "provider.endpoint.upsert"; endpoint: ProviderModelEndpointPatchInput })
  | (ConfigCommandRequestInput & {
      type: "provider.endpoint.delete";
      providerId: string;
      cascadeModels?: boolean;
      replacementDefaultModelId?: string;
    })
  | (ConfigCommandRequestInput & {
      type: "provider.endpoint.rename";
      providerId: string;
      nextProviderId: string;
    })
  | (ConfigCommandRequestInput & {
      type: "provider.model.upsert";
      model: ProviderModelConfigInput;
      group?: ProviderModelGroupAssignmentInput;
    })
  | (ConfigCommandRequestInput & {
      type: "provider.model.delete";
      modelId: string;
      replacementDefaultModelId?: string;
    })
  | (ConfigCommandRequestInput & {
      type: "provider.model.bulkImport";
      models: ProviderModelConfigInput[];
      overwriteExisting?: boolean;
      groupAssignments?: ProviderModelBulkImportGroupAssignmentInput[];
    })
  | (ConfigCommandRequestInput & { type: "provider.defaultModel.set"; modelId: string });

export type ProviderModelConfigCommandDraft = ProviderModelConfigRequest extends infer Request
  ? Request extends ConfigCommandRequestInput
    ? Omit<Request, "commandId">
    : never
  : never;
