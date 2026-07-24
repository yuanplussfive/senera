import type {
  ConfigFormSectionData,
  ProviderModelsFailedData,
  ProviderModelsSnapshotData,
} from "../../../api/eventTypes";
import type { JsonConfigObject } from "../../../shared/config/JsonConfigForm";
import { frontendMessage } from "../../../i18n/frontendMessageCatalog";
import {
  findTopField,
  normalizeProviderEndpointDraft,
  readProviderEndpoints,
  toProviderEndpointInput,
} from "../../chat/modelConfigData";
import type { ProviderEndpointDraft, ProviderModelEndpointInput } from "../../chat/modelConfigTypes";
import type { ProviderModelEndpointPatchInput } from "../../../api/eventTypes";
import { createJsonMergePatch } from "../../../shared/config/jsonMergePatch";
import { readModelServiceState, type ModelServiceState } from "./modelServiceState";

export interface ProviderConnectionStateInput {
  catalogs: Record<string, ProviderModelsSnapshotData>;
  errors: Record<string, ProviderModelsFailedData & { updatedAt?: string }>;
  loadingIds: Record<string, boolean>;
  section: ConfigFormSectionData;
  snapshotValue: JsonConfigObject;
  selectedProviderId?: string | null;
}

export interface ProviderConnectionDraftState {
  acceptedProvider: ProviderEndpointDraft | null;
  connectionDraft: ProviderEndpointDraft | null;
  dirty: boolean;
}

export type ProviderEndpointMutationInput<
  Endpoint extends ProviderModelEndpointInput | ProviderModelEndpointPatchInput = ProviderModelEndpointPatchInput,
> =
  | {
      ok: true;
      endpoint: Endpoint;
      providerId: string;
    }
  | {
      ok: false;
      message: string;
    };

export function readProviderConnectionState({
  catalogs,
  errors,
  loadingIds,
  section,
  snapshotValue,
  selectedProviderId,
}: ProviderConnectionStateInput): ModelServiceState {
  return readModelServiceState({
    catalogs,
    draft: readProviderConnectionConfigValue(snapshotValue, section),
    errors,
    loadingIds,
    section,
    selectedProviderId,
  });
}

export function readProviderConnectionConfigValue(
  snapshotValue: JsonConfigObject,
  section: ConfigFormSectionData,
): JsonConfigObject {
  const effectiveProviders = readProviderEndpoints(
    findTopField(section, "ModelProviderEndpoints")?.effectiveValue ?? snapshotValue.ModelProviderEndpoints,
  );
  return {
    ...snapshotValue,
    ModelProviderEndpoints: effectiveProviders,
    ModelProviders: findTopField(section, "ModelProviders")?.effectiveValue ?? snapshotValue.ModelProviders,
    ModelGroups: findTopField(section, "ModelGroups")?.effectiveValue ?? snapshotValue.ModelGroups,
    DefaultModelProviderId:
      findTopField(section, "DefaultModelProviderId")?.effectiveValue ?? snapshotValue.DefaultModelProviderId,
  };
}

export function readProviderConnectionDraftState({
  acceptedProvider,
  draftProvider,
}: {
  acceptedProvider: ProviderEndpointDraft | null;
  draftProvider: ProviderEndpointDraft | null;
}): ProviderConnectionDraftState {
  const acceptedDraft = acceptedProvider ? normalizeProviderEndpointDraft(acceptedProvider) : null;
  const connectionDraft =
    draftProvider && acceptedDraft?.Id === draftProvider.Id
      ? normalizeProviderEndpointDraft(draftProvider)
      : acceptedDraft;

  return {
    acceptedProvider: acceptedDraft,
    connectionDraft,
    dirty: Boolean(acceptedDraft && connectionDraft && !sameProviderEndpoint(connectionDraft, acceptedDraft)),
  };
}

export function applyProviderConnectionDraftPatch({
  acceptedProvider,
  currentDraft,
  patch,
}: {
  acceptedProvider: ProviderEndpointDraft | null;
  currentDraft: ProviderEndpointDraft | null;
  patch: Partial<ProviderEndpointDraft>;
}): ProviderEndpointDraft {
  return normalizeProviderEndpointDraft({
    ...(currentDraft ?? acceptedProvider ?? {}),
    ...patch,
  });
}

export function resetProviderConnectionDraft(
  acceptedProvider: ProviderEndpointDraft | null,
): ProviderEndpointDraft | null {
  return acceptedProvider ? normalizeProviderEndpointDraft(acceptedProvider) : null;
}

export function buildProviderEndpointMutationInput(
  connectionDraft: ProviderEndpointDraft | null,
): ProviderEndpointMutationInput<ProviderModelEndpointInput>;
export function buildProviderEndpointMutationInput(
  connectionDraft: ProviderEndpointDraft | null,
  baseDraft: ProviderEndpointDraft,
): ProviderEndpointMutationInput<ProviderModelEndpointPatchInput>;
export function buildProviderEndpointMutationInput(
  connectionDraft: ProviderEndpointDraft | null,
  baseDraft?: ProviderEndpointDraft,
): ProviderEndpointMutationInput<ProviderModelEndpointInput | ProviderModelEndpointPatchInput> {
  if (!connectionDraft) {
    return {
      ok: false,
      message: frontendMessage("settings.provider.chooseRequired"),
    };
  }
  const providerId = connectionDraft.Id.trim();
  if (!providerId) {
    return {
      ok: false,
      message: frontendMessage("settings.provider.idRequired"),
    };
  }
  const endpoint = toProviderEndpointInput({
    ...connectionDraft,
    Id: providerId,
  });
  return {
    ok: true,
    providerId,
    endpoint: baseDraft
      ? createJsonMergePatch(toProviderEndpointInput(baseDraft), endpoint, ["Id"] as const)
      : endpoint,
  };
}

export function providerIdentitySnapshot(provider: ProviderEndpointDraft): ProviderEndpointDraft {
  return normalizeProviderEndpointDraft({
    Id: provider.Id,
    ...(provider.Icon ? { Icon: provider.Icon } : {}),
    ...(provider.Kind ? { Kind: provider.Kind } : {}),
  });
}

export function sameProviderEndpoint(left: ProviderEndpointDraft, right: ProviderEndpointDraft): boolean {
  return JSON.stringify(normalizeProviderEndpointDraft(left)) === JSON.stringify(normalizeProviderEndpointDraft(right));
}
