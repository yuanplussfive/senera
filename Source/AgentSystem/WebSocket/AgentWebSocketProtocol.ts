import { z } from "zod";
import { AgentSessionMessageDispositionValues } from "../Session/AgentSessionMessageDisposition.js";
import { AgentSessionMessageQueueModeValues } from "../Session/AgentSessionMessageQueueMode.js";
import { createRequestId } from "../Core/AgentIds.js";
import { AgentUserProfileInputSchema } from "../Session/AgentUserProfile.js";
import { AgentUploadAttachmentListSchema } from "../Uploads/AgentUploadTypes.js";
import { AgentSystemConfigSchema } from "../Schemas/AgentSystemConfigSchema.js";
import { ModelProviderSchema } from "../Schemas/AgentModelConfigSchema.js";
import { AgentProviderEndpointPatchSchema } from "../Config/AgentConfigCommandSchemas.js";
import { SeneraTerminalDimensionLimits } from "../Execution/SeneraTerminalTypes.js";
import { AgentApprovalDecisions } from "../Approvals/AgentApprovalTypes.js";
import { AgentInteractionInputActions } from "../Interaction/AgentInteractionInputTypes.js";
import { AgentPiSessionExportFormats } from "../Pi/AgentPiSessionManagement.js";
import { AgentExtensionInputValueSchema } from "../Extensions/AgentExtensionInput.js";

const AgentInteractionInputValueSchema = z.union([z.string(), z.number().finite(), z.boolean(), z.array(z.string())]);

const AgentPresetFormatSchema = z.enum(["json", "markdown", "text"]);

const AgentConfigRevisionGuardRequestSchema = {
  commandId: z.string().min(1),
  baseRevision: z.number().int().min(1).optional(),
  baseVersion: z.number().int().min(1).optional(),
} as const;

const AgentConfigCommandRequestSchema = {
  commandId: z.string().min(1),
} as const;

const AgentProviderModelEndpointRequestSchema = z
  .object({
    Id: z.string().min(1),
    Icon: z.string().optional(),
    Enabled: z.boolean().optional(),
    Kind: z.literal("OpenAICompatible").optional(),
    BaseUrl: z.string().optional(),
    ApiKey: z.string().optional(),
    ApiVersion: z.string().optional(),
    Headers: z.record(z.string(), z.string()).optional(),
  })
  .strict();

const AgentProviderModelGroupAssignmentRequestSchema = z
  .object({
    groupId: z.string().min(1),
    label: z.string().min(1).optional(),
    icon: z.string().min(1).optional(),
  })
  .strict();

const AgentProviderModelBulkImportGroupAssignmentRequestSchema = AgentProviderModelGroupAssignmentRequestSchema.extend({
  modelId: z.string().min(1),
});

const AgentExecutionResourceIdSchema = z
  .string()
  .trim()
  .regex(/^res_[a-f0-9]{32}$/i);
const AgentExecutionResourceSessionSchema = {
  sessionId: z.string().min(1),
} as const;

export const AgentWebSocketRequestSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("session.create"),
      sessionId: z.string().min(1).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("session.message"),
      sessionId: z.string().min(1),
      requestId: z.string().min(1).optional(),
      modelProviderId: z.string().min(1).optional(),
      input: z.string().min(1),
      attachments: AgentUploadAttachmentListSchema.optional(),
      disposition: z.enum(AgentSessionMessageDispositionValues).optional(),
      queueMode: z.enum(AgentSessionMessageQueueModeValues).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("session.close"),
      sessionId: z.string().min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal("session.cancel"),
      sessionId: z.string().min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal("session.truncate_from"),
      sessionId: z.string().min(1),
      requestId: z.string().min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal("session.regenerate"),
      sessionId: z.string().min(1),
      fromRequestId: z.string().min(1),
      requestId: z.string().min(1),
      modelProviderId: z.string().min(1).optional(),
      input: z.string().min(1),
      attachments: AgentUploadAttachmentListSchema.optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("session.fork"),
      sourceSessionId: z.string().min(1),
      sessionId: z.string().min(1),
      throughRequestId: z.string().min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal("session.compact"),
      sessionId: z.string().min(1),
      customInstructions: z.string().trim().min(1).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("session.runtime_status"),
      sessionId: z.string().min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal("session.export"),
      sessionId: z.string().min(1),
      format: z.enum(AgentPiSessionExportFormats),
    })
    .strict(),
  z
    .object({
      type: z.literal("session.list"),
    })
    .strict(),
  z
    .object({
      type: z.literal("session.history"),
      sessionId: z.string().min(1),
      refresh: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("session.rename"),
      sessionId: z.string().min(1),
      title: z.string().min(1).max(120),
    })
    .strict(),
  z
    .object({
      type: z.literal("model.list"),
    })
    .strict(),
  z
    .object({
      type: z.literal("provider.models.fetch"),
      providerId: z.string().min(1),
      force: z.boolean().optional(),
      endpoint: AgentProviderModelEndpointRequestSchema.optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("config.get"),
    })
    .strict(),
  z.object({ type: z.literal("systemTool.list") }).strict(),
  z.object({ type: z.literal("mcpServer.list") }).strict(),
  z
    .object({
      type: z.literal("mcpServer.restart"),
      serverId: z.string().trim().min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal("mcpInput.set"),
      serverId: z.string().trim().min(1),
      inputId: z.string().trim().min(1),
      value: AgentExtensionInputValueSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("mcpInput.delete"),
      serverId: z.string().trim().min(1),
      inputId: z.string().trim().min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal("mcpInput.update"),
      requestId: z.string().trim().min(1),
      serverId: z.string().trim().min(1),
      values: z.record(z.string().trim().min(1), AgentExtensionInputValueSchema),
      deletes: z.array(z.string().trim().min(1)).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("mcpCredential.set"),
      serverId: z.string().trim().min(1),
      name: z.string().trim().min(1),
      value: z.string().min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal("mcpCredential.delete"),
      serverId: z.string().trim().min(1),
      name: z.string().trim().min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal("config.update"),
      ...AgentConfigRevisionGuardRequestSchema,
      config: AgentSystemConfigSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("provider.endpoint.upsert"),
      ...AgentConfigCommandRequestSchema,
      endpoint: AgentProviderEndpointPatchSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("provider.endpoint.delete"),
      ...AgentConfigCommandRequestSchema,
      providerId: z.string().min(1),
      cascadeModels: z.boolean().optional(),
      replacementDefaultModelId: z.string().min(1).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("provider.endpoint.rename"),
      ...AgentConfigCommandRequestSchema,
      providerId: z.string().min(1),
      nextProviderId: z.string().min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal("provider.model.upsert"),
      ...AgentConfigCommandRequestSchema,
      model: ModelProviderSchema.describe(
        "Complete model configuration. Replaces an existing model with the same Id; omitted optional overrides are cleared.",
      ),
      group: AgentProviderModelGroupAssignmentRequestSchema.optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("provider.model.delete"),
      ...AgentConfigCommandRequestSchema,
      modelId: z.string().min(1),
      replacementDefaultModelId: z.string().min(1).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("provider.model.bulkImport"),
      ...AgentConfigCommandRequestSchema,
      models: z
        .array(ModelProviderSchema)
        .describe(
          "Complete model configurations to import. Existing Ids are skipped unless overwriteExisting is true.",
        ),
      overwriteExisting: z
        .boolean()
        .optional()
        .describe(
          "When true, completely replaces existing models with matching Ids; omitted optional overrides are cleared.",
        ),
      groupAssignments: z.array(AgentProviderModelBulkImportGroupAssignmentRequestSchema).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("provider.defaultModel.set"),
      ...AgentConfigCommandRequestSchema,
      modelId: z.string().min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal("preset.list"),
    })
    .strict(),
  z
    .object({
      type: z.literal("preset.save"),
      requestId: z.string().min(1).optional(),
      name: z.string().min(1),
      format: AgentPresetFormatSchema,
      content: z.string(),
      activate: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("preset.delete"),
      requestId: z.string().min(1).optional(),
      name: z.string().min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal("preset.set_active"),
      requestId: z.string().min(1).optional(),
      name: z.string().min(1).nullable().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("profile.get"),
    })
    .strict(),
  z
    .object({
      type: z.literal("profile.update"),
      profile: AgentUserProfileInputSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("approval.resolve"),
      approvalId: z.string().min(1),
      decision: z.enum(AgentApprovalDecisions),
      message: z.string().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("interaction.input.resolve"),
      interactionId: z.string().min(1),
      action: z.enum(AgentInteractionInputActions),
      content: z.record(z.string(), AgentInteractionInputValueSchema).optional(),
      message: z.string().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("sandbox.status"),
    })
    .strict(),
  z
    .object({
      type: z.literal("execution.resource.list"),
      ...AgentExecutionResourceSessionSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("execution.resource.inspect"),
      ...AgentExecutionResourceSessionSchema,
      resourceId: AgentExecutionResourceIdSchema,
      cursor: z.number().int().min(0).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("execution.resource.write"),
      ...AgentExecutionResourceSessionSchema,
      resourceId: AgentExecutionResourceIdSchema,
      input: z.string(),
    })
    .strict(),
  z
    .object({
      type: z.literal("execution.resource.resize"),
      ...AgentExecutionResourceSessionSchema,
      resourceId: AgentExecutionResourceIdSchema,
      columns: z
        .number()
        .int()
        .min(SeneraTerminalDimensionLimits.minColumns)
        .max(SeneraTerminalDimensionLimits.maxColumns),
      rows: z.number().int().min(SeneraTerminalDimensionLimits.minRows).max(SeneraTerminalDimensionLimits.maxRows),
    })
    .strict(),
  z
    .object({
      type: z.literal("execution.resource.signal"),
      ...AgentExecutionResourceSessionSchema,
      resourceId: AgentExecutionResourceIdSchema,
      signal: z.enum(["interrupt", "terminate", "kill"]),
    })
    .strict(),
  z
    .object({
      type: z.literal("execution.resource.stop_all"),
      ...AgentExecutionResourceSessionSchema,
    })
    .strict(),
]);

export type AgentWebSocketRequest = z.infer<typeof AgentWebSocketRequestSchema>;
export type AgentWebSocketRequestOf<TType extends AgentWebSocketRequest["type"]> = Extract<
  AgentWebSocketRequest,
  { type: TType }
>;

export { createRequestId };
