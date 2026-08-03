import type {
  ConfigFormSectionData,
  ProviderModelsFailedData,
  ProviderModelsSnapshotData,
} from "../../../api/eventTypes";
import type { JsonConfigObject } from "../../../shared/config/JsonConfigForm";
import { frontendMessage } from "../../../i18n/frontendMessageCatalog";
import {
  findTopField,
  isRedactedConfigSecret,
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

export interface ActiveProviderSave {
  draft: ProviderEndpointDraft;
  providerId: string;
  requestId: string;
}

export interface ProviderDraftEntry {
  synced: ProviderEndpointDraft;
  draft: ProviderEndpointDraft;
  active?: ActiveProviderSave;
  queuedDraft?: ProviderEndpointDraft;
  awaitingSnapshot?: ProviderEndpointDraft;
  error?: string;
  autoSaveBlocked: boolean;
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
  // The backend schema requires BaseUrl to parse as a URL; reject locally so a
  // half-typed value surfaces as an inline error instead of a rejected command.
  if (endpoint.BaseUrl !== undefined && !isParseableUrl(endpoint.BaseUrl)) {
    return {
      ok: false,
      message: frontendMessage("settings.provider.invalidBaseUrl"),
    };
  }
  return {
    ok: true,
    providerId,
    endpoint: baseDraft
      ? createJsonMergePatch(toProviderEndpointInput(baseDraft), endpoint, ["Id"] as const)
      : endpoint,
  };
}

function isParseableUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

export function providerIdentitySnapshot(provider: ProviderEndpointDraft): ProviderEndpointDraft {
  return normalizeProviderEndpointDraft({
    Id: provider.Id,
    ...(provider.Icon ? { Icon: provider.Icon } : {}),
    ...(provider.Kind ? { Kind: provider.Kind } : {}),
  });
}

export function sameProviderEndpoint(left: ProviderEndpointDraft, right: ProviderEndpointDraft): boolean {
  return JSON.stringify(canonicalProviderEndpoint(left)) === JSON.stringify(canonicalProviderEndpoint(right));
}

/**
 * A successful save can only be confirmed from the redacted config snapshot.
 * Redacted values match a submitted non-empty secret here, but never in the
 * ordinary dirty comparator above where a newly typed secret is a real edit.
 */
export function providerEndpointSnapshotMatchesDraft(
  snapshot: ProviderEndpointDraft,
  draft: ProviderEndpointDraft,
): boolean {
  const current = canonicalProviderEndpoint(snapshot);
  const expected = canonicalProviderEndpoint(draft);
  if (
    current.Id !== expected.Id ||
    current.Icon !== expected.Icon ||
    current.Enabled !== expected.Enabled ||
    current.Kind !== expected.Kind ||
    current.BaseUrl !== expected.BaseUrl ||
    current.ApiVersion !== expected.ApiVersion ||
    !snapshotSecretMatchesDraft(current.ApiKey, expected.ApiKey) ||
    current.Headers.length !== expected.Headers.length
  ) {
    return false;
  }
  return current.Headers.every(([name, value], index) => {
    const expectedHeader = expected.Headers[index];
    return Boolean(
      expectedHeader && name === expectedHeader[0] && snapshotSecretMatchesDraft(value, expectedHeader[1]),
    );
  });
}

export function createProviderDraftEntry(provider: ProviderEndpointDraft): ProviderDraftEntry {
  const normalized = normalizeProviderEndpointDraft(provider);
  return {
    synced: normalized,
    draft: normalized,
    autoSaveBlocked: false,
  };
}

export function rebaseProviderEndpoint(
  base: ProviderEndpointDraft,
  local: ProviderEndpointDraft | null,
  remote: ProviderEndpointDraft,
): ProviderEndpointDraft {
  if (!local) return normalizeProviderEndpointDraft(remote);
  const result: Record<string, unknown> = { ...normalizeProviderEndpointDraft(remote) };
  const baseRecord = normalizeProviderEndpointDraft(base) as unknown as Record<string, unknown>;
  const localRecord = normalizeProviderEndpointDraft(local) as unknown as Record<string, unknown>;
  for (const key of new Set([...Object.keys(baseRecord), ...Object.keys(localRecord)])) {
    const baseHas = Object.prototype.hasOwnProperty.call(baseRecord, key);
    const localHas = Object.prototype.hasOwnProperty.call(localRecord, key);
    if (!localHas && baseHas) {
      delete result[key];
      continue;
    }
    if (localHas && (!baseHas || JSON.stringify(localRecord[key]) !== JSON.stringify(baseRecord[key]))) {
      result[key] = localRecord[key];
    }
  }
  return normalizeProviderEndpointDraft(result as unknown as ProviderEndpointDraft);
}

interface CanonicalProviderEndpoint {
  Id: string;
  Icon: string;
  Enabled: boolean;
  Kind: string;
  BaseUrl: string;
  ApiKey: string;
  ApiVersion: string;
  Headers: Array<readonly [name: string, value: string]>;
}

function canonicalProviderEndpoint(provider: ProviderEndpointDraft): CanonicalProviderEndpoint {
  const normalized = normalizeProviderEndpointDraft(provider);
  return {
    Id: normalized.Id,
    Icon: normalized.Icon ?? "",
    Enabled: normalized.Enabled !== false,
    Kind: normalized.Kind ?? "",
    BaseUrl: normalized.BaseUrl ?? "",
    ApiKey: normalized.ApiKey ?? "",
    ApiVersion: normalized.ApiVersion ?? "",
    Headers: Object.entries(normalized.Headers ?? {}).sort(([left], [right]) => compareStrings(left, right)),
  };
}

function snapshotSecretMatchesDraft(snapshot: string, draft: string): boolean {
  return snapshot === draft || (isRedactedConfigSecret(snapshot) && draft.length > 0);
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
