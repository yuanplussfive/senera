import { z } from "zod";

const RootCommandToolSelectorSchema = z.discriminatedUnion("Source", [
  z
    .object({
      Source: z.literal("None"),
    })
    .strict(),
  z
    .object({
      Source: z.literal("Loaded"),
    })
    .strict(),
  z
    .object({
      Source: z.literal("NamedLoaded"),
      Names: z.array(z.string().min(1)).min(1),
    })
    .strict(),
  z
    .object({
      Source: z.literal("HostCapability"),
      Capability: z.string().min(1),
    })
    .strict(),
  z
    .object({
      Source: z.literal("PreferredLoaded"),
    })
    .strict(),
  z
    .object({
      Source: z.literal("PreferredLoadedOrLoaded"),
    })
    .strict(),
]);

const RootCommandVisibleOutputRuleSchema = z
  .object({
    Name: z.string().min(1),
    Value: z.string().min(1),
    Instruction: z.string().min(1).optional(),
  })
  .strict();

const RootCommandVisibleOutputSchema = z
  .object({
    Audience: z.string().min(1),
    Start: z.string().min(1),
    Format: z.string().min(1),
    Rules: z.array(RootCommandVisibleOutputRuleSchema),
    Repair: z
      .object({
        Instruction: z.string().min(1),
        Rules: z.array(RootCommandVisibleOutputRuleSchema),
      })
      .strict(),
  })
  .strict();

export const RootCommandSchema = z
  .object({
    Action: z.string().min(1),
    OutputMode: z.enum(["tool_call_xml", "final_text", "open"]),
    ToolAccess: z.enum(["disabled", "restricted", "discovery_only"]),
    Objective: z.string().min(1),
    InsufficiencyPolicy: z.string().min(1),
    AllowedTools: z.array(RootCommandToolSelectorSchema),
    ForbiddenOutputs: z.array(z.string().min(1)),
    VisibleOutput: RootCommandVisibleOutputSchema,
    IncludeDecisionProtocol: z.boolean(),
    IncludeToolCatalog: z.boolean(),
  })
  .strict();

