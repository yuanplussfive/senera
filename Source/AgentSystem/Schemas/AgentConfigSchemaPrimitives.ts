import { z } from "zod";

export const disabledOrPositiveInteger = (fieldName: string) =>
  z.union([z.literal(-1), z.number().int().min(1)], {
    error: `${fieldName} 必须为 -1，或大于等于 1。`,
  });

export const disabledOrPositiveNumber = (fieldName: string) =>
  z.union([z.literal(-1), z.number().positive()], {
    error: `${fieldName} 必须为 -1，或大于 0。`,
  });
