import { z } from "zod";
import { createRequestId } from "../Core/AgentIds.js";
import { AgentUserProfileInputSchema } from "../Session/AgentUserProfile.js";
import { AgentUploadAttachmentListSchema } from "../Uploads/AgentUploadTypes.js";
import { AgentSystemConfigSchema } from "../Schemas/AgentSystemConfigSchema.js";
import { ModelProviderEndpointSchema, ModelProviderSchema } from "../Schemas/AgentModelConfigSchema.js";

const AgentPresetFormatSchema = z.enum(["json", "markdown", "text"]);

const AgentConfigRevisionGuardRequestSchema = {
  requestId: z.string().min(1).optional(),
  expectedRevision: z.number().int().min(1).optional(),
  expectedVersion: z.number().int().min(1).optional(),
  mirrorJson: z.boolean().optional(),
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

export const AgentWebSocketRequestSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("session.create"),
      sessionId: z.string().min(1).optional(),
      modelProviderId: z.string().min(1).optional(),
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
      queueMode: z.enum(["steer", "follow_up"]).optional(),
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
  z
    .object({
      type: z.literal("config.update"),
      requestId: z.string().min(1).optional(),
      config: AgentSystemConfigSchema,
      mirrorJson: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("provider.endpoint.upsert"),
      ...AgentConfigRevisionGuardRequestSchema,
      endpoint: ModelProviderEndpointSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("provider.endpoint.delete"),
      ...AgentConfigRevisionGuardRequestSchema,
      providerId: z.string().min(1),
      cascadeModels: z.boolean().optional(),
      replacementDefaultModelId: z.string().min(1).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("provider.endpoint.rename"),
      ...AgentConfigRevisionGuardRequestSchema,
      providerId: z.string().min(1),
      nextProviderId: z.string().min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal("provider.model.upsert"),
      ...AgentConfigRevisionGuardRequestSchema,
      model: ModelProviderSchema,
      group: AgentProviderModelGroupAssignmentRequestSchema.optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("provider.model.delete"),
      ...AgentConfigRevisionGuardRequestSchema,
      modelId: z.string().min(1),
      replacementDefaultModelId: z.string().min(1).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("provider.model.bulkImport"),
      ...AgentConfigRevisionGuardRequestSchema,
      models: z.array(ModelProviderSchema),
      overwriteExisting: z.boolean().optional(),
      groupAssignments: z.array(AgentProviderModelBulkImportGroupAssignmentRequestSchema).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("provider.defaultModel.set"),
      ...AgentConfigRevisionGuardRequestSchema,
      modelId: z.string().min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal("plugin.config.list"),
    })
    .strict(),
  z
    .object({
      type: z.literal("plugin.config.update"),
      requestId: z.string().min(1).optional(),
      pluginName: z.string().min(1),
      toml: z.string(),
    })
    .strict(),
  z
    .object({
      type: z.literal("plugin.config.set_enabled"),
      requestId: z.string().min(1).optional(),
      pluginName: z.string().min(1),
      toolName: z.string().min(1).optional(),
      enabled: z.boolean(),
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
      status: z.enum(["approved", "denied"]),
      message: z.string().optional(),
      scope: z.enum(["once", "session"]).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("sandbox.status"),
    })
    .strict(),
]);

export type AgentWebSocketRequest = z.infer<typeof AgentWebSocketRequestSchema>;
export type AgentWebSocketRequestOf<TType extends AgentWebSocketRequest["type"]> = Extract<
  AgentWebSocketRequest,
  { type: TType }
>;

export { createRequestId };
