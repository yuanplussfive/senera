import { ModelProviderEndpointSchema } from "../Schemas/AgentModelConfigSchema.js";

/**
 * Published command contracts are immutable. New command fields are exposed
 * through explicitly versioned schemas.
 */
const ModelProviderEndpointCommandV1Schema = ModelProviderEndpointSchema.omit({
  ProviderId: true,
  Priority: true,
});

export const AgentConfigCommandSchemaCatalog = {
  "model-provider-endpoint": ModelProviderEndpointCommandV1Schema,
  "model-provider-endpoint-v2": ModelProviderEndpointSchema,
  "model-provider-endpoint-v3": ModelProviderEndpointSchema,
} as const;

export type AgentConfigCommandSchemaId = keyof typeof AgentConfigCommandSchemaCatalog;
