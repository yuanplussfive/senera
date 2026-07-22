import { z } from "zod";
import { ToolArtifactPolicySchema } from "./PluginArtifactManifestSchema.js";
import { ToolSearchSchema } from "./PluginSearchManifestSchema.js";
import {
  inspectPluginToolRuntimeCapabilityContract,
  inspectPluginToolRuntimeContract,
} from "../Types/PluginToolRuntimeContract.js";
import { ToolExecutionTargets, ToolLoadingModes } from "../Types/PluginToolManifestTypes.js";
import { isAgentMcpJsonPointer } from "../Mcp/AgentMcpJsonPointer.js";

const JsonPointerSchema = z.string().refine(isAgentMcpJsonPointer, "Expected a non-root RFC 6901 JSON Pointer.");

const ToolResourceArgumentSchema = z
  .object({
    Capability: z.string().trim().min(1),
    Pointer: JsonPointerSchema,
    Binding: z
      .string()
      .regex(/^[A-Za-z][A-Za-z0-9_]*$/u, "Resource binding must be an identifier.")
      .optional(),
    Parameters: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

const ToolHandlerSchema = z.discriminatedUnion("Kind", [
  z
    .object({
      Kind: z.literal("HostCapability"),
      Capability: z.string().min(1),
    })
    .strict(),
  z
    .object({
      Kind: z.literal("McpTool"),
      Server: z.string().min(1),
      Tool: z.string().min(1),
      Resources: z.array(ToolResourceArgumentSchema).optional(),
    })
    .strict(),
]);

const ToolEvidenceCapabilitySchema = z
  .object({
    Produces: z.string().min(1),
    Quality: z.string().min(1),
    Satisfies: z.array(z.string().min(1)).optional(),
    Kinds: z.array(z.string().min(1)).optional(),
    CapabilityIds: z.array(z.string().min(1)).optional(),
  })
  .strict();

const ToolApprovalSchema = z
  .object({
    Mode: z.enum(["allow", "ask", "deny"]),
    Reason: z.string().min(1).optional(),
  })
  .strict();

const ToolExecutionSchema = z
  .object({
    Targets: z.array(z.enum([ToolExecutionTargets.Sandbox, ToolExecutionTargets.Local])).min(1),
    Network: z.enum(["Allow", "Deny"]),
    Workspace: z.enum(["ReadOnly", "ReadWrite"]),
  })
  .strict()
  .superRefine((execution, context) => {
    const seen = new Set<string>();
    execution.Targets.forEach((target, index) => {
      if (seen.has(target)) {
        context.addIssue({
          code: "custom",
          path: ["Targets", index],
          message: `Execution target ${target} may only be declared once.`,
        });
      }
      seen.add(target);
    });
  });

const ToolRuntimeCapabilitiesSchema = z
  .object({
    Progress: z.boolean().optional(),
    OutputStreaming: z.boolean().optional(),
    InteractiveInput: z.boolean().optional(),
    Cancellation: z.boolean().optional(),
    ResumableEvents: z.boolean().optional(),
  })
  .strict();

const ToolRuntimeSchema = z
  .object({
    Lifecycle: z.enum(["Immediate", "OneShot", "Persistent", "RemoteJob"]),
    ProtocolVersion: z.literal(2).optional(),
    Capabilities: ToolRuntimeCapabilitiesSchema.optional(),
  })
  .strict();

const ToolObservationContinuationSchema = z
  .object({
    Kind: z.enum(["session", "cursor", "offset", "artifact"]),
    Handle: z.string().min(1),
    Cursor: z.string().min(1).optional(),
    State: z.string().min(1).optional(),
    TerminalStates: z.array(z.string().min(1)).optional(),
  })
  .strict();

const ToolObservationSchema = z
  .object({
    MaxTokens: z.number().int().min(1).optional(),
    IncludeArtifactProjection: z.boolean().optional(),
    Continuation: ToolObservationContinuationSchema.optional(),
  })
  .strict();

export const ToolSchema = z
  .object({
    Name: z.string().min(1),
    Loading: z.enum([ToolLoadingModes.Bootstrap, ToolLoadingModes.Dynamic]).optional(),
    DescriptionFile: z.string().min(1).optional(),
    Permissions: z.array(z.string()).optional(),
    Handler: ToolHandlerSchema,
    Execution: ToolExecutionSchema,
    Runtime: ToolRuntimeSchema,
    Observation: ToolObservationSchema.optional(),
    Search: ToolSearchSchema.optional(),
    EvidenceCapabilities: z.array(ToolEvidenceCapabilitySchema).optional(),
    Approval: ToolApprovalSchema.optional(),
    Artifacts: ToolArtifactPolicySchema.optional(),
    ArtifactPolicyFile: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((tool, context) => {
    const issuePaths = {
      handler: ["Handler", "Kind"],
      lifecycle: ["Runtime", "Lifecycle"],
      protocolVersion: ["Runtime", "ProtocolVersion"],
    } as const;
    for (const issue of inspectPluginToolRuntimeContract({
      handlerKind: tool.Handler.Kind,
      lifecycle: tool.Runtime.Lifecycle,
      protocolVersion: tool.Runtime.ProtocolVersion,
    })) {
      context.addIssue({
        code: "custom",
        path: [...issuePaths[issue.field]],
        message: issue.message,
      });
    }
    for (const issue of inspectPluginToolRuntimeCapabilityContract({
      handlerKind: tool.Handler.Kind,
      lifecycle: tool.Runtime.Lifecycle,
      capabilities: tool.Runtime.Capabilities,
    })) {
      context.addIssue({
        code: "custom",
        path: ["Runtime", "Capabilities", issue.capability],
        message: issue.message,
      });
    }
  });
