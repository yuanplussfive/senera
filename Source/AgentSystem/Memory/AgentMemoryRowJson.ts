import { z } from "zod";
import { parseJsonText } from "../Core/AgentJsonParsing.js";

const MemoryRowMetadataSchema = z.record(z.string(), z.unknown());

export function parseMemoryRowJsonObject(value: string): Record<string, unknown> {
  return MemoryRowMetadataSchema.parse(parseJsonText(value, "Memory row JSON"));
}
