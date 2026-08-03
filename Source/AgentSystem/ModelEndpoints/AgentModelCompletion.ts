export interface AgentModelCompletionMetadata {
  readonly finishReason?: string;
  readonly status?: string;
}

export function createAgentModelCompletionMetadata(
  values: AgentModelCompletionMetadata,
): AgentModelCompletionMetadata | undefined {
  const finishReason = normalizeCompletionValue(values.finishReason);
  const status = normalizeCompletionValue(values.status);
  return finishReason || status ? { finishReason, status } : undefined;
}

export function mergeAgentModelCompletionMetadata(
  current: AgentModelCompletionMetadata | undefined,
  update: AgentModelCompletionMetadata | undefined,
): AgentModelCompletionMetadata | undefined {
  return update
    ? createAgentModelCompletionMetadata({
        finishReason: update.finishReason ?? current?.finishReason,
        status: update.status ?? current?.status,
      })
    : current;
}

function normalizeCompletionValue(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}
