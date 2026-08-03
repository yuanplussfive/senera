import { AgentLocalizedError } from "../I18n/AgentLocalizedError.js";
import type { AgentErrorMessageKey, AgentMessageParams } from "../I18n/AgentMessageCatalog.js";
import type { AgentModelProviderConfig } from "../Types/AgentConfigTypes.js";
import type { AgentProviderEndpointPatch } from "./AgentConfigCommandSchemas.js";

export type AgentProviderModelConfigOperationKind =
  | "provider.endpoint.upsert"
  | "provider.endpoint.delete"
  | "provider.endpoint.rename"
  | "provider.model.upsert"
  | "provider.model.delete"
  | "provider.model.bulkImport"
  | "provider.defaultModel.set";

export interface AgentConfigRevisionGuardInput {
  baseRevision?: number;
  baseVersion?: number;
}

export interface AgentConfigCommandInput {
  commandId: string;
}

export interface AgentProviderModelGroupAssignmentInput {
  groupId: string;
  label?: string;
  icon?: string;
}

export interface AgentProviderEndpointUpsertInput extends AgentConfigCommandInput {
  endpoint: AgentProviderEndpointPatch;
}

export interface AgentProviderEndpointRenameInput extends AgentConfigCommandInput {
  providerId: string;
  nextProviderId: string;
}

export interface AgentProviderEndpointDeleteInput extends AgentConfigCommandInput {
  providerId: string;
  cascadeModels?: boolean;
  replacementDefaultModelId?: string;
}

export interface AgentProviderModelUpsertInput extends AgentConfigCommandInput {
  /** Complete replacement for an existing model with the same Id. */
  model: AgentModelProviderConfig;
  group?: AgentProviderModelGroupAssignmentInput;
}

export interface AgentProviderModelBulkImportGroupAssignmentInput extends AgentProviderModelGroupAssignmentInput {
  modelId: string;
}

export interface AgentProviderModelBulkImportInput extends AgentConfigCommandInput {
  /** Complete model definitions. Existing Ids are skipped unless overwriteExisting is true. */
  models: AgentModelProviderConfig[];
  /** Completely replace models with matching Ids instead of skipping them. */
  overwriteExisting?: boolean;
  groupAssignments?: AgentProviderModelBulkImportGroupAssignmentInput[];
}

export interface AgentProviderModelDeleteInput extends AgentConfigCommandInput {
  modelId: string;
  replacementDefaultModelId?: string;
}

export interface AgentDefaultModelSetInput extends AgentConfigCommandInput {
  modelId: string;
}

export class AgentProviderModelConfigCommandError extends AgentLocalizedError {
  constructor(
    messageKey: AgentErrorMessageKey,
    readonly code: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(messageKey, projectCommandMessageParams(details));
  }
}

export class AgentConfigStaleWriteError extends AgentLocalizedError {
  readonly code = "config_stale_write";

  constructor(
    readonly details: {
      baseRevision?: number;
      currentRevision?: number;
      baseVersion?: number;
      currentVersion: number;
    },
  ) {
    super(
      details.currentRevision === undefined ? "config.staleWriteVersion" : "config.staleWriteRevision",
      details.currentRevision === undefined
        ? {
            baseVersion: details.baseVersion ?? "missing",
            currentVersion: details.currentVersion,
          }
        : {
            baseRevision: details.baseRevision ?? "missing",
            currentRevision: details.currentRevision,
          },
    );
  }
}

export function assertConfigRevisionGuard(
  input: AgentConfigRevisionGuardInput,
  current: {
    revision?: number;
    version: number;
  },
): void {
  if (current.revision !== undefined) {
    if (input.baseRevision === current.revision) return;
    throw new AgentConfigStaleWriteError({
      baseRevision: input.baseRevision,
      currentRevision: current.revision,
      baseVersion: input.baseVersion,
      currentVersion: current.version,
    });
  }
  if (input.baseVersion === current.version) return;
  throw new AgentConfigStaleWriteError({
    baseRevision: input.baseRevision,
    currentRevision: current.revision,
    baseVersion: input.baseVersion,
    currentVersion: current.version,
  });
}

function projectCommandMessageParams(details: Record<string, unknown> | undefined): AgentMessageParams {
  if (!details) return {};
  return Object.fromEntries(
    Object.entries(details).filter((entry): entry is [string, string | number | boolean | null] => {
      const value = entry[1];
      return value === null || ["string", "number", "boolean"].includes(typeof value);
    }),
  );
}
