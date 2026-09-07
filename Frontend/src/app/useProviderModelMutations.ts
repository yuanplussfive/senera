import { useCallback, useMemo } from "react";
import { toast } from "sonner";
import { frontendMessage, type FrontendMessageKey } from "../i18n/frontendMessageCatalog";
import {
  configTransportFailureValue,
  type ConfigEntityMutationResolution,
  type ConfigTransportFailureValues,
  type PendingConfigEntityMutation,
} from "./configEntityMutation";
import {
  isProviderModelOperationKind,
  type ProviderModelConfigRequest,
  type ProviderModelDeleteInput,
  type ProviderModelOperationKind,
  type ProviderModelUpsertInput,
} from "./providerModelMutations";
import { useConfigEntityMutations } from "./useConfigEntityMutations";
import type { SystemConfigCommandQueue, SystemConfigCommandTransportFailure } from "./useSystemConfigCommandQueue";

export interface ProviderModelMutationTransport {
  commandQueue: SystemConfigCommandQueue;
}

const ProviderModelTransportMessageKeys = {
  configUnavailable: "config.mainFailed",
  disconnected: "config.mainDisconnected",
  offline: "config.mainOffline",
} as const satisfies ConfigTransportFailureValues<FrontendMessageKey>;

export function useProviderModelMutations({ commandQueue }: ProviderModelMutationTransport) {
  const lifecycle = useMemo(
    () => ({
      commandQueue,
      isOperationKind: isProviderModelOperationKind,
      onResolution: presentProviderModelResolution,
      onTransportFailure: presentProviderModelTransportFailure,
      transportFailureMessage: providerModelTransportFailureMessage,
    }),
    [commandQueue],
  );
  const { ingest, operations, start } = useConfigEntityMutations(lifecycle);

  const startModelMutation = useCallback(
    (kind: ProviderModelOperationKind, modelId: string, request: ProviderModelConfigRequest) =>
      start(
        { kind, entityId: modelId },
        request,
        kind === "provider.model.upsert" ? { coalesceKey: `${kind}:${modelId}` } : undefined,
      ),
    [start],
  );

  const upsertProviderModel = useCallback(
    (input: ProviderModelUpsertInput): string | null =>
      startModelMutation("provider.model.upsert", input.model.Id, {
        type: "provider.model.upsert",
        model: input.model,
        ...(input.group ? { group: input.group } : {}),
      }),
    [startModelMutation],
  );
  const deleteProviderModel = useCallback(
    (input: ProviderModelDeleteInput): string | null =>
      startModelMutation("provider.model.delete", input.modelId, {
        type: "provider.model.delete",
        ...input,
      }),
    [startModelMutation],
  );
  const setDefaultProviderModel = useCallback(
    (modelId: string): string | null =>
      startModelMutation("provider.defaultModel.set", modelId, {
        type: "provider.defaultModel.set",
        modelId,
      }),
    [startModelMutation],
  );

  return useMemo(
    () => ({
      deleteProviderModel,
      ingestConfigMutationEvent: ingest,
      providerModelOperations: operations,
      setDefaultProviderModel,
      upsertProviderModel,
    }),
    [deleteProviderModel, ingest, operations, setDefaultProviderModel, upsertProviderModel],
  );
}

function providerModelTransportFailureMessage(
  _mutation: PendingConfigEntityMutation<ProviderModelOperationKind>,
  failure: SystemConfigCommandTransportFailure,
): string {
  return frontendMessage(configTransportFailureValue(failure, ProviderModelTransportMessageKeys));
}

function presentProviderModelTransportFailure(
  _mutation: PendingConfigEntityMutation<ProviderModelOperationKind>,
  _failure: SystemConfigCommandTransportFailure,
  message: string,
): void {
  toast.error(message);
}

function presentProviderModelResolution(resolution: ConfigEntityMutationResolution<ProviderModelOperationKind>): void {
  if (resolution.outcome === "success") {
    if (resolution.mutation.kind === "provider.model.delete") {
      toast.success(frontendMessage("config.mainSaved"));
    }
    return;
  }
  toast.error(frontendMessage("config.mainFailed"), { description: resolution.message });
}
