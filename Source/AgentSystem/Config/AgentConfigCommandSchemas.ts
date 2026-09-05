import { z } from "zod";
import { createAgentJsonMergePatchSchema, type AgentJsonMergePatch } from "../Core/AgentJsonMergePatch.js";
import type { AgentModelProviderEndpointConfig } from "../Types/AgentConfigTypes.js";
import runtimeContract from "./CommandContracts/runtime.json" with { type: "json" };
import {
  loadAgentConfigCommandRuntimeContract,
  type AgentConfigCommandRuntimeContract,
} from "./AgentConfigCommandContract.js";
import { AgentConfigCommandSchemaCatalog } from "./AgentConfigCommandSchemaCatalog.js";

type AgentConfigCommandOperation = keyof typeof runtimeContract.definition.operations;

export const AgentConfigCommandSchemas = compileAgentConfigCommandSchemas(runtimeContract);

export type AgentProviderEndpointPatch = AgentJsonMergePatch<AgentModelProviderEndpointConfig, "Id">;

export const AgentProviderEndpointPatchSchema = AgentConfigCommandSchemas[
  "provider.endpoint.upsert"
] as z.ZodType<AgentProviderEndpointPatch>;

function compileAgentConfigCommandSchemas(value: unknown): Readonly<Record<AgentConfigCommandOperation, z.ZodType>> {
  const contract = loadAgentConfigCommandRuntimeContract(value);
  return Object.freeze(
    Object.fromEntries(
      Object.entries(contract.definition.operations).map(([operation, definition]) => [
        operation,
        compileOperationSchema(contract, operation, definition),
      ]),
    ) as Record<AgentConfigCommandOperation, z.ZodType>,
  );
}

function compileOperationSchema(
  contract: AgentConfigCommandRuntimeContract,
  operation: string,
  definition: AgentConfigCommandRuntimeContract["definition"]["operations"][string],
): z.ZodType {
  const baseSchema = AgentConfigCommandSchemaCatalog[definition.schema];
  if (definition.semantics === "json-merge-patch") {
    return createAgentJsonMergePatchSchema(
      baseSchema,
      definition.identityFields as readonly (keyof z.output<typeof baseSchema> & string)[],
    );
  }
  throw new Error(
    `Configuration command contract ${contract.id} v${contract.version} has unsupported semantics for ${operation}.`,
  );
}
