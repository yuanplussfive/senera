import { ModelProviderEndpointSchema } from "../Schemas/AgentModelConfigSchema.js";

/**
 * Published command contracts are immutable.  Keep the v1 projection frozen
 * even though the runtime endpoint schema has gained pool metadata since v1.
 * New command fields are exposed through the explicitly versioned v2 schema.
 */
const ModelProviderEndpointCommandV1Schema = ModelProviderEndpointSchema.omit({
  ProviderId: true,
  Priority: true,
});

export const AgentConfigCommandSchemaCatalog = {
  "model-provider-endpoint": ModelProviderEndpointCommandV1Schema,
  "model-provider-endpoint-v2": ModelProviderEndpointSchema,
} as const;

export type AgentConfigCommandSchemaId = keyof typeof AgentConfigCommandSchemaCatalog;
