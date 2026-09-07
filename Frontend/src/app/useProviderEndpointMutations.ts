import { useCallback, useMemo } from "react";
import { toast } from "sonner";
import type { ProviderModelEndpointPatchInput } from "../api/eventTypes";
import { frontendMessage } from "../i18n/frontendMessageCatalog";
import {
  configTransportFailureValue,
  type ConfigEntityMutationResolution,
  type PendingConfigEntityMutation,
} from "./configEntityMutation";
import {
  isProviderEndpointOperationKind,
  providerEndpointMessageKeys,
  type ProviderEndpointConfigRequest,
  type ProviderEndpointDeleteOptions,
  type ProviderEndpointOperationKind,
} from "./providerEndpointMutations";
import { useConfigEntityMutations } from "./useConfigEntityMutations";
import type { SystemConfigCommandQueue, SystemConfigCommandTransportFailure } from "./useSystemConfigCommandQueue";

export interface ProviderEndpointMutationTransport {
  commandQueue: SystemConfigCommandQueue;
}

export function useProviderEndpointMutations({ commandQueue }: ProviderEndpointMutationTransport) {
  const lifecycle = useMemo(
    () => ({
      commandQueue,
      isOperationKind: isProviderEndpointOperationKind,
      onResolution: presentProviderEndpointResolution,
      onTransportFailure: presentProviderEndpointTransportFailure,
      transportFailureMessage: providerEndpointTransportFailureMessage,
    }),
    [commandQueue],
  );
  const { ingest, operations, start } = useConfigEntityMutations(lifecycle);

  const startEndpointMutation = useCallback(
    (kind: ProviderEndpointOperationKind, providerId: string, request: ProviderEndpointConfigRequest) =>
      start(
        { kind, entityId: providerId },
        request,
        kind === "provider.endpoint.upsert" ? { coalesceKey: `${kind}:${providerId}` } : undefined,
      ),
    [start],
  );

  const upsertProviderEndpoint = useCallback(
    (endpoint: ProviderModelEndpointPatchInput) =>
      startEndpointMutation("provider.endpoint.upsert", endpoint.Id, {
        type: "provider.endpoint.upsert",
        endpoint,
      }),
    [startEndpointMutation],
  );
  const renameProviderEndpoint = useCallback(
    (providerId: string, nextProviderId: string) =>
      startEndpointMutation("provider.endpoint.rename", providerId, {
        type: "provider.endpoint.rename",
        providerId,
        nextProviderId,
      }),
    [startEndpointMutation],
  );
  const deleteProviderEndpoint = useCallback(
    (providerId: string, options: ProviderEndpointDeleteOptions = {}) =>
      startEndpointMutation("provider.endpoint.delete", providerId, {
        type: "provider.endpoint.delete",
        providerId,
        ...options,
      }),
    [startEndpointMutation],
  );

  return useMemo(
    () => ({
      deleteProviderEndpoint,
      ingestProviderEndpointMutationEvent: ingest,
      providerEndpointOperations: operations,
      renameProviderEndpoint,
      upsertProviderEndpoint,
    }),
    [deleteProviderEndpoint, ingest, operations, renameProviderEndpoint, upsertProviderEndpoint],
  );
}

function providerEndpointTransportFailureMessage(
  mutation: PendingConfigEntityMutation<ProviderEndpointOperationKind>,
  failure: SystemConfigCommandTransportFailure,
): string {
  return frontendMessage(configTransportFailureValue(failure, providerEndpointMessageKeys[mutation.kind]));
}

function presentProviderEndpointTransportFailure(
  _mutation: PendingConfigEntityMutation<ProviderEndpointOperationKind>,
  _failure: SystemConfigCommandTransportFailure,
  message: string,
): void {
  toast.error(message);
}

function presentProviderEndpointResolution(
  resolution: ConfigEntityMutationResolution<ProviderEndpointOperationKind>,
): void {
  const copy = providerEndpointMessageKeys[resolution.mutation.kind];
  if (resolution.outcome === "success") {
    if (resolution.mutation.kind !== "provider.endpoint.upsert") {
      toast.success(frontendMessage(copy.success));
    }
    return;
  }
  toast.error(frontendMessage(copy.failure), { description: resolution.message });
}
