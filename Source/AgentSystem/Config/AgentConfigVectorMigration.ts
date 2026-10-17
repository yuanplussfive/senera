import { isAgentUnknownRecord as isRecord } from "../Core/AgentUnknownValue.js";

const RetiredVectorCapabilityNames = ["Embedding", "Rerank"] as const;

/** Removes the retired top-level remote-vector configuration block. */
export function removeRetiredVectorModels(
  container: Record<string, unknown>,
  prefix: string,
  removedPaths: string[],
): void {
  if (!Object.hasOwn(container, "VectorModels")) return;
  delete container.VectorModels;
  removedPaths.push(`${prefix}VectorModels`);
}

/**
 * Retires fields whose schema ownership is known without treating any model
 * or endpoint identifier as a product-owned namespace. Model and endpoint
 * IDs are user data, so an upgrade must never infer that `emb` or `emb/...`
 * belongs to a previous Senera vector implementation.
 */
export function removeRetiredVectorModelPool(
  container: Record<string, unknown>,
  prefix: string,
  removedPaths: string[],
): void {
  if (!Array.isArray(container.ModelProviders)) return;
  removeRetiredCapabilityFlags(container.ModelProviders, prefix, removedPaths);
}

function removeRetiredCapabilityFlags(providers: readonly unknown[], prefix: string, removedPaths: string[]): void {
  providers.forEach((provider, index) => {
    if (!isRecord(provider) || !isRecord(provider.Capabilities)) return;
    for (const capability of RetiredVectorCapabilityNames) {
      if (!Object.hasOwn(provider.Capabilities, capability)) continue;
      delete provider.Capabilities[capability];
      removedPaths.push(`${prefix}ModelProviders[${index}].Capabilities.${capability}`);
    }
  });
}
