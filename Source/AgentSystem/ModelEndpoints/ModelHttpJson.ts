import { z } from "zod";
import type { JsonObject } from "./ModelEndpointTypes.js";

export const ModelHttpJsonObjectSchema = z.record(z.string(), z.unknown());

export function parseModelHttpJsonObject(value: unknown): JsonObject {
  return ModelHttpJsonObjectSchema.parse(value);
}
