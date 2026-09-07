import { ModelProviderEndpointSchema } from "../Schemas/AgentModelConfigSchema.js";

export const AgentConfigCommandSchemaCatalog = {
  "model-provider-endpoint": ModelProviderEndpointSchema,
} as const;

export type AgentConfigCommandSchemaId = keyof typeof AgentConfigCommandSchemaCatalog;
