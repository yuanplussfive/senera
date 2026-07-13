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

export type ProviderModelEndpointKind =
  | "Responses"
  | "ChatCompletions"
  | "ClaudeMessages"
  | "GoogleGenerateContent";

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
  requestId?: string;
  expectedRevision?: number;
  expectedVersion?: number;
  mirrorJson?: boolean;
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
  | (ConfigRevisionGuardRequestInput & { type: "provider.endpoint.upsert"; endpoint: ProviderModelEndpointInput })
  | (ConfigRevisionGuardRequestInput & {
      type: "provider.endpoint.delete";
      providerId: string;
      cascadeModels?: boolean;
      replacementDefaultModelId?: string;
    })
  | (ConfigRevisionGuardRequestInput & {
      type: "provider.endpoint.rename";
      providerId: string;
      nextProviderId: string;
    })
  | (ConfigRevisionGuardRequestInput & {
      type: "provider.model.upsert";
      model: ProviderModelConfigInput;
      group?: ProviderModelGroupAssignmentInput;
    })
  | (ConfigRevisionGuardRequestInput & {
      type: "provider.model.delete";
      modelId: string;
      replacementDefaultModelId?: string;
    })
  | (ConfigRevisionGuardRequestInput & {
      type: "provider.model.bulkImport";
      models: ProviderModelConfigInput[];
      overwriteExisting?: boolean;
      groupAssignments?: ProviderModelBulkImportGroupAssignmentInput[];
    })
  | (ConfigRevisionGuardRequestInput & { type: "provider.defaultModel.set"; modelId: string });
