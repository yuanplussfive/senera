import { z } from "zod";
import { safeParseNormalizedBamlOutput } from "../BamlClient/AgentBamlOutputNormalizer.js";
import { AgentStructuredOutputValidationError } from "../Diagnostics/AgentStructuredOutputValidationError.js";

type JsonValue = string | number | boolean | JsonValue[] | JsonObject;

interface JsonObject {
  [key: string]: JsonValue;
}

const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([z.string(), z.number(), z.boolean(), z.array(JsonValueSchema), z.record(z.string(), JsonValueSchema)]),
);

const PiToolArgumentsDraftSchema = z
  .object({
    arguments: z.record(z.string(), JsonValueSchema),
    missingInputs: z.array(z.string()),
    assumptions: z.array(z.string()),
  })
  .strict();

export type ParsedPiToolArgumentsDraft = z.infer<typeof PiToolArgumentsDraftSchema>;

export function parsePiToolArgumentsDraft(value: unknown): ParsedPiToolArgumentsDraft {
  const parsed = safeParseNormalizedBamlOutput(PiToolArgumentsDraftSchema, value);
  if (!parsed.success) {
    throw new AgentStructuredOutputValidationError(parsed.structuredIssues, parsed.normalized);
  }

  return parsed.data;
}
