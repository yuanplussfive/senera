import { z } from "zod";

export const disabledOrPositiveInteger = (fieldName: string) =>
  z
    .number()
    .int()
    .refine((value) => value === -1 || value >= 1, {
      message: `${fieldName} 必须为 -1，或大于等于 1。`,
    });

export const disabledOrPositiveNumber = (fieldName: string) =>
  z.number().refine((value) => value === -1 || value > 0, {
    message: `${fieldName} 必须为 -1，或大于 0。`,
  });
