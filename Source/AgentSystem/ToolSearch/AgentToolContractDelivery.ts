import { z } from "zod";
import { sha256HexOfCanonicalJson } from "../Core/AgentHash.js";
import type { RegisteredTool } from "../Types/AgentToolRuntimeTypes.js";
import type { ToolExecutionTarget } from "../Types/AgentToolContractTypes.js";
import {
  AgentToolDescriptionProtocol,
  AgentToolDiscoveryProtocol,
  AgentToolPreparationProtocol,
} from "./AgentToolMetaToolProtocol.js";
import { projectToolDescription, type AgentToolDescriptionTuple } from "./AgentToolMetaToolProjector.js";

/** Host-only receipt: hashes never need to be repeated in the model's contract text. */
export const AgentToolContractReceiptSchema = z
  .object({
    toolName: z.string().min(1),
    contractDigest: z.string().min(1),
    descriptionDigest: z.string().min(1),
  })
  .strict();

export type AgentToolContractReceipt = z.infer<typeof AgentToolContractReceiptSchema>;

const descriptionSchema = z.tuple([z.string(), z.string(), z.string()]);
const descriptionResultSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal(AgentToolDescriptionProtocol.type), tools: z.array(descriptionSchema) }),
  z.object({ type: z.literal(AgentToolDiscoveryProtocol.type), contracts: z.array(descriptionSchema) }),
  z.object({ type: z.literal(AgentToolPreparationProtocol.type), contract: descriptionSchema }),
]);

export function readDeliveredToolDescriptions(result: unknown): readonly AgentToolDescriptionTuple[] {
  const parsed = descriptionResultSchema.safeParse(result);
  if (!parsed.success) return [];
  if ("contract" in parsed.data) return [parsed.data.contract];
  return "tools" in parsed.data ? parsed.data.tools : parsed.data.contracts;
}

export function createAgentToolContractDelivery(tool: RegisteredTool, targets: readonly ToolExecutionTarget[]) {
  if (!tool.contract?.digest) throw new Error(`Tool ${tool.name} has no registered contract digest.`);
  const description = projectToolDescription(tool, targets);
  const receipt: AgentToolContractReceipt = {
    toolName: tool.name,
    contractDigest: tool.contract.digest,
    descriptionDigest: sha256HexOfCanonicalJson(description),
  };
  return { description, receipt };
}

/** Compression or truncation must not turn an omitted contract into confirmed evidence. */
export function retainDeliveredToolContractReceipts(
  receipts: readonly AgentToolContractReceipt[],
  result: unknown,
): AgentToolContractReceipt[] {
  const delivered = new Map(
    readDeliveredToolDescriptions(result).map((item) => [item[0], sha256HexOfCanonicalJson(item)]),
  );
  return receipts.filter((receipt) => delivered.get(receipt.toolName) === receipt.descriptionDigest);
}
