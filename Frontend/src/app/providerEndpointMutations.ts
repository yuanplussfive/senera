import type {
  ProviderModelConfigOperationKind,
  ProviderModelConfigCommandDraft,
} from "../api/providerModelCommandTypes";
import type { FrontendMessageKey } from "../i18n/frontendMessageCatalog";

export type ProviderEndpointOperationKind = Extract<
  ProviderModelConfigOperationKind,
  "provider.endpoint.upsert" | "provider.endpoint.rename" | "provider.endpoint.delete"
>;

export type ProviderEndpointConfigRequest = Extract<
  ProviderModelConfigCommandDraft,
  { type: ProviderEndpointOperationKind }
>;

export interface ProviderEndpointDeleteOptions {
  cascadeModels?: boolean;
  replacementDefaultModelId?: string;
}

export const providerEndpointMessageKeys = {
  "provider.endpoint.upsert": {
    offline: "config.providerEndpointUpsertOffline",
    configUnavailable: "config.providerEndpointUpsertConfigUnavailable",
    disconnected: "config.providerEndpointUpsertDisconnected",
    success: "config.providerEndpointUpsertSucceeded",
    failure: "config.providerEndpointUpsertFailed",
  },
  "provider.endpoint.rename": {
    offline: "config.providerEndpointRenameOffline",
    configUnavailable: "config.providerEndpointRenameConfigUnavailable",
    disconnected: "config.providerEndpointRenameDisconnected",
    success: "config.providerEndpointRenameSucceeded",
    failure: "config.providerEndpointRenameFailed",
  },
  "provider.endpoint.delete": {
    offline: "config.providerEndpointDeleteOffline",
    configUnavailable: "config.providerEndpointDeleteConfigUnavailable",
    disconnected: "config.providerEndpointDeleteDisconnected",
    success: "config.providerEndpointDeleteSucceeded",
    failure: "config.providerEndpointDeleteFailed",
  },
} as const satisfies Record<
  ProviderEndpointOperationKind,
  Record<"offline" | "configUnavailable" | "disconnected" | "success" | "failure", FrontendMessageKey>
>;

export function isProviderEndpointOperationKind(kind: unknown): kind is ProviderEndpointOperationKind {
  return (
    kind === "provider.endpoint.upsert" || kind === "provider.endpoint.rename" || kind === "provider.endpoint.delete"
  );
}
