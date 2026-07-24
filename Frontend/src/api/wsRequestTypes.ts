import type { ApprovalDecision } from "./approvalEventTypes";
import type { PresetFormat, ProviderModelEndpointInput, UploadAttachmentData, UserProfileData } from "./eventTypes";
import type { ProviderModelConfigRequest } from "./providerModelCommandTypes";
import type { InteractionInputAction, InteractionInputContent } from "./interactionInputEventTypes";

export type WsRequest =
  | { type: "session.create"; sessionId?: string }
  | {
      type: "session.message";
      sessionId: string;
      requestId?: string;
      modelProviderId?: string;
      input: string;
      attachments?: UploadAttachmentData[];
      disposition?: "create_if_missing" | "require_existing";
      queueMode?: "steer" | "follow_up";
    }
  | { type: "session.close"; sessionId: string }
  | { type: "session.cancel"; sessionId: string }
  | { type: "session.truncate_from"; sessionId: string; requestId: string }
  | {
      type: "session.regenerate";
      sessionId: string;
      fromRequestId: string;
      requestId: string;
      modelProviderId?: string;
      input: string;
      attachments?: UploadAttachmentData[];
    }
  | { type: "session.fork"; sourceSessionId: string; sessionId: string; throughRequestId: string }
  | { type: "session.list" }
  | { type: "session.history"; sessionId: string; refresh?: boolean }
  | { type: "session.rename"; sessionId: string; title: string }
  | { type: "model.list" }
  | { type: "provider.models.fetch"; providerId: string; force?: boolean; endpoint?: ProviderModelEndpointInput }
  | { type: "config.get" }
  | {
      type: "config.update";
      commandId: string;
      baseRevision?: number;
      baseVersion?: number;
      config: Record<string, unknown>;
    }
  | ProviderModelConfigRequest
  | { type: "plugin.config.list" }
  | { type: "plugin.config.update"; requestId?: string; pluginName: string; toml: string }
  | { type: "plugin.config.set_enabled"; requestId?: string; pluginName: string; toolName?: string; enabled: boolean }
  | { type: "preset.list" }
  | { type: "preset.save"; requestId?: string; name: string; format: PresetFormat; content: string; activate?: boolean }
  | { type: "preset.delete"; requestId?: string; name: string }
  | { type: "preset.set_active"; requestId?: string; name?: string | null }
  | { type: "profile.get" }
  | { type: "profile.update"; profile: Pick<UserProfileData, "name" | "avatarDataUrl"> }
  | { type: "approval.resolve"; approvalId: string; decision: ApprovalDecision; message?: string }
  | {
      type: "interaction.input.resolve";
      interactionId: string;
      action: InteractionInputAction;
      content?: InteractionInputContent;
      message?: string;
    }
  | { type: "sandbox.status" }
  | { type: "execution.resource.list"; sessionId: string }
  | { type: "execution.resource.inspect"; sessionId: string; resourceId: string; cursor?: number }
  | { type: "execution.resource.write"; sessionId: string; resourceId: string; input: string }
  | {
      type: "execution.resource.resize";
      sessionId: string;
      resourceId: string;
      columns: number;
      rows: number;
    }
  | {
      type: "execution.resource.signal";
      sessionId: string;
      resourceId: string;
      signal: "interrupt" | "terminate" | "kill";
    }
  | { type: "execution.resource.stop_all"; sessionId: string };
