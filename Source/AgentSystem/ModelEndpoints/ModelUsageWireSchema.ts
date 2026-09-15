import { z } from "zod";

/** Provider usage metadata is optional telemetry; wire protocols may represent an absent value as null. */
export const ModelUsageNumberWireSchema = z.number().nullish();

export function projectModelUsageNumber(value: number | null | undefined): number | undefined {
  return value ?? undefined;
}
