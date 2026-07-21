import { z } from "zod";
import { AgentToolContractVersion, type AgentToolContractBundle } from "./AgentToolContractTypes.js";

const JsonSchemaObject = z.record(z.string(), z.unknown());

export const AgentToolContractBundleSchema: z.ZodType<AgentToolContractBundle> = z
  .object({
    contractVersion: z.literal(AgentToolContractVersion),
    tools: z.record(
      z.string().min(1),
      z
        .object({
          source: z.discriminatedUnion("kind", [
            z
              .object({
                kind: z.literal("typescript"),
                identity: z.string().min(1),
                file: z.string().min(1),
                type: z.string().min(1).optional(),
                sha256: z.string().regex(/^[a-f0-9]{64}$/u),
              })
              .strict(),
            z
              .object({
                kind: z.literal("schema"),
                identity: z.string().min(1),
                file: z.string().min(1).optional(),
                sha256: z.string().regex(/^[a-f0-9]{64}$/u),
              })
              .strict(),
          ]),
          inputSchema: JsonSchemaObject,
          outputSchema: JsonSchemaObject.optional(),
        })
        .strict(),
    ),
  })
  .strict();
