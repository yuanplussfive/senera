import type { ApprovalResolvedData } from "./approvalEventTypes";
import type { PresetFormat, ProviderModelEndpointInput, UploadAttachmentData, UserProfileData } from "./eventTypes";
import type { ProviderModelConfigRequest } from "./providerModelCommandTypes";

type ApprovalResolveStatus = ApprovalResolvedData["status"];

export type WsRequest =
  | { type: "session.create"; sessionId?: string; modelProviderId?: string }
  | {
      type: "session.message";
      sessionId: string;
      requestId?: string;
      modelProviderId?: string;
      input: string;
      attachments?: UploadAttachmentData[];
      queueMode?: "steer" | "follow_up";
    }
  | { type: "session.close"; sessionId: string }
  | { type: "session.cancel"; sessionId: string }
  | { type: "session.truncate_from"; sessionId: string; requestId: string }
  | { type: "session.list" }
  | { type: "session.history"; sessionId: string; refresh?: boolean }
  | { type: "session.rename"; sessionId: string; title: string }
  | { type: "model.list" }
  | { type: "provider.models.fetch"; providerId: string; force?: boolean; endpoint?: ProviderModelEndpointInput }
  | { type: "config.get" }
  | { type: "config.update"; requestId?: string; config: Record<string, unknown>; mirrorJson?: boolean }
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
  | { type: "approval.resolve"; approvalId: string; status: ApprovalResolveStatus; message?: string }
  | { type: "sandbox.status" };
