import { z } from "zod";

const PrimitiveValue = z.union([z.string(), z.number(), z.boolean()]);

type XmlValue =
  | string
  | number
  | boolean
  | null
  | XmlValue[]
  | { [key: string]: XmlValue };

const XmlValueSchema: z.ZodType<XmlValue> = z.lazy(() =>
  z.union([
    PrimitiveValue,
    z.null(),
    z.array(XmlValueSchema),
    z.record(z.string(), XmlValueSchema),
  ]),
);

export const Schema = z
  .object({
    tool_call: z
      .array(
        z.object({
          name: z.string().min(1),
          arguments: z.preprocess(
            (value) => value === "" || value === null || value === undefined ? {} : value,
            z.record(z.string(), XmlValueSchema),
          ).default({}),
        }).strict(),
      )
      .min(1)
      .max(8),
  })
  .strict();
