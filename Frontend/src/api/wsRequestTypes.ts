import type { ApprovalDecision } from "./approvalEventTypes";
import type {
  ModelThinkingLevel,
  ProviderModelEndpointInput,
  UploadAttachmentData,
  UserProfileData,
  ConversationIdentityData,
  ExplicitActivationSet,
} from "./eventTypes";
import type { ProviderModelConfigRequest } from "./providerModelCommandTypes";
import type { InteractionInputAction, InteractionInputContent } from "./interactionInputEventTypes";
import type { FeedbackCategory, FeedbackRating } from "./feedbackEventTypes";
import type { ExecutionApprovalMode } from "./executionApprovalMode";

export type WsRequest =
  | { type: "session.create"; sessionId?: string }
  | {
      type: "session.message";
      sessionId: string;
      requestId?: string;
      modelProviderId?: string;
      thinkingLevel?: ModelThinkingLevel;
      input: string;
      approvalMode: ExecutionApprovalMode;
      attachments?: UploadAttachmentData[];
      disposition?: "create_if_missing" | "require_existing";
      queueMode?: "steer" | "follow_up";
      activations?: ExplicitActivationSet;
    }
  | { type: "session.close"; sessionId: string }
  | { type: "session.close_many"; sessionIds: string[] }
  | { type: "session.cancel"; sessionId: string; requestId?: string }
  | { type: "session.truncate_from"; sessionId: string; requestId: string }
  | {
      type: "session.regenerate";
      sessionId: string;
      fromRequestId: string;
      requestId: string;
      modelProviderId?: string;
      thinkingLevel?: ModelThinkingLevel;
      input: string;
      approvalMode: ExecutionApprovalMode;
      attachments?: UploadAttachmentData[];
      activations?: ExplicitActivationSet;
    }
  | {
      type: "session.retry";
      sessionId: string;
      failedRequestId: string;
      requestId: string;
      recoveryMode: "retry" | "continue";
      modelProviderId?: string;
      thinkingLevel?: ModelThinkingLevel;
      approvalMode: ExecutionApprovalMode;
      activations?: ExplicitActivationSet;
    }
  | { type: "session.fork"; sourceSessionId: string; sessionId: string; throughRequestId: string }
  | { type: "session.compact"; sessionId: string; customInstructions?: string }
  | { type: "session.runtime_status"; sessionId: string }
  | { type: "session.export"; sessionId: string; format: "jsonl" | "html" }
  | { type: "session.list" }
  | { type: "session.history"; sessionId: string; refresh?: boolean; initialWindow?: boolean }
  | { type: "session.rename"; sessionId: string; title: string }
  | {
      type: "session.feedback";
      sessionId: string;
      requestId: string;
      /** `null` retracts a previously recorded rating. */
      rating: FeedbackRating | null;
      category?: FeedbackCategory;
    }
  | { type: "model.list" }
  | { type: "provider.models.fetch"; providerId: string; force?: boolean; endpoint?: ProviderModelEndpointInput }
  | { type: "config.get" }
  | { type: "workspace.get" }
  | { type: "workspace.switch"; requestId: string; workspaceRoot: string }
  | { type: "systemTool.list" }
  | { type: "mcpServer.list" }
  | { type: "runtimeDependency.list" }
  | { type: "runtimeDependency.check"; dependencyId: string }
  | { type: "runtimeDependency.install"; dependencyId: string }
  | { type: "mcpServer.restart"; serverId: string }
  | { type: "channel.connect"; kind: "telegram" | "qq" | "discord" }
  | {
      type: "mcpInput.set";
      serverId: string;
      inputId: string;
      value: string | number | boolean | string[] | number[] | boolean[];
    }
  | { type: "mcpInput.delete"; serverId: string; inputId: string }
  | {
      type: "mcpInput.update";
      requestId: string;
      serverId: string;
      values: Record<string, string | number | boolean | string[] | number[] | boolean[]>;
      deletes?: string[];
    }
  | { type: "mcpCredential.set"; serverId: string; name: string; value: string }
  | { type: "mcpCredential.delete"; serverId: string; name: string }
  | {
      type: "config.update";
      commandId: string;
      baseRevision?: number;
      baseVersion?: number;
      config: Record<string, unknown>;
    }
  | ProviderModelConfigRequest
  | { type: "profile.get" }
  | {
      type: "profile.update";
      profile: Pick<UserProfileData, "name" | "avatarDataUrl" | "avatarPath"> & {
        assistant?: ConversationIdentityData;
      };
    }
  | { type: "approval.resolve"; approvalId: string; decision: ApprovalDecision; message?: string }
  | {
      type: "approval.resolve_batch";
      sessionId: string;
      requestId: string;
      batchId: string;
      decision: ApprovalDecision;
      message?: string;
    }
  | {
      type: "interaction.input.resolve";
      interactionId: string;
      action: InteractionInputAction;
      content?: InteractionInputContent;
      message?: string;
    }
  | { type: "sandbox.status" }
  | {
      type: "execution.resource.start_terminal";
      sessionId: string;
      cwd?: string;
      columns?: number;
      rows?: number;
    }
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
  | { type: "execution.resource.close"; sessionId: string; resourceId: string }
  | { type: "execution.resource.stop_all"; sessionId: string };
