import { z } from "zod";
import {
  AgentToolContentPolicyCompressionModes,
  AgentToolContentPolicyDeduplicationModes,
  AgentToolContentPolicyKinds,
  AgentToolContentPolicyOwnerships,
  AgentToolContentPolicyPreservables,
  AgentToolContentPolicyRepresentations,
} from "../Types/AgentToolContentPolicyTypes.js";
import { isAgentJsonPointer } from "../Core/AgentJsonPointerOperations.js";

const JsonPointerSchema = z.string().refine(isAgentJsonPointer, "Expected an RFC 6901 JSON Pointer.");

export const AgentToolContentPolicySchema = z
  .object({
    ownership: z.enum(AgentToolContentPolicyOwnerships),
    kind: z.enum(AgentToolContentPolicyKinds),
    representation: z.enum(AgentToolContentPolicyRepresentations),
    compression: z.enum(AgentToolContentPolicyCompressionModes),
    deduplication: z.enum(AgentToolContentPolicyDeduplicationModes),
    targets: z.array(JsonPointerSchema).max(64).optional(),
    preserve: z.array(z.enum(AgentToolContentPolicyPreservables)).max(16).optional(),
  })
  .strict()
  .superRefine((policy, context) => {
    if (
      policy.kind === AgentToolContentPolicyKinds.WebReadable &&
      policy.representation === AgentToolContentPolicyRepresentations.Json
    ) {
      context.addIssue({
        code: "custom",
        path: ["representation"],
        message: "web-readable content must use text, markdown, or html representation.",
      });
    }
    if (
      policy.kind === AgentToolContentPolicyKinds.AssetReference &&
      policy.representation !== AgentToolContentPolicyRepresentations.Preserve
    ) {
      context.addIssue({
        code: "custom",
        path: ["representation"],
        message: "asset-reference content must preserve the resource payload.",
      });
    }
    if (
      policy.kind === AgentToolContentPolicyKinds.Execution &&
      policy.deduplication !== AgentToolContentPolicyDeduplicationModes.None
    ) {
      context.addIssue({
        code: "custom",
        path: ["deduplication"],
        message: "execution output cannot use prose deduplication; use tokenjuice or a tool-owned digest.",
      });
    }
    if (
      policy.ownership === AgentToolContentPolicyOwnerships.Tool &&
      policy.compression !== AgentToolContentPolicyCompressionModes.None
    ) {
      context.addIssue({
        code: "custom",
        path: ["compression"],
        message: "tool-owned content must not be compressed again by the host.",
      });
    }
  });

export type ParsedAgentToolContentPolicy = z.infer<typeof AgentToolContentPolicySchema>;
