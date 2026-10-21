import type {
  ConfigMutationState,
  ConfigSnapshotData,
  ModelProviderListItem,
  ModelThinkingLevel,
  ProviderModelEndpointInput,
  ProviderModelsFailedData,
  ProviderModelsSnapshotData,
  SandboxStatusSnapshotData,
  UploadAttachmentData,
  InteractionInputAction,
  InteractionInputContent,
  AgentActivationCatalogSnapshot,
  ExplicitActivationSet,
} from "../../api/eventTypes";
import type { SocketStatus } from "../../api/useAgentSocket";
import type { ApprovalBatchReference, ApprovalDecision } from "../../api/approvalEventTypes";
import type { MessageQueueMode } from "../../app/useChatCommands";
import type { SettingsSectionId } from "../settings/settingsSectionContract";
import type { ChatMessage, UserProfile } from "../../store/sessionStore";
import type { ExecutionApprovalMode } from "../../api/executionApprovalMode";

export interface ChatModelConfig {
  modelProviders: ModelProviderListItem[];
  selectedModelProviderId: string | null;
  /** Server-configured default used for new conversations and inherited selections. */
  defaultModelProviderId?: string | null;
  onSelectModelProvider: (id: string) => void;
  selectedThinkingLevel: ModelThinkingLevel | null;
  onSelectThinkingLevel: (level: ModelThinkingLevel) => void;
  /** Restores the active conversation to the current configured default model. */
  onApplyDefaultModel?: () => void;
  /** Opens provider settings so another model can be configured. */
  onAddModel?: () => void;
}

export interface ChatApprovalConfig {
  mode: ExecutionApprovalMode;
  onSelectMode: (mode: ExecutionApprovalMode) => void;
}

export interface ChatSystemConfig {
  configSnapshot: ConfigSnapshotData | null;
  configOperation: ConfigMutationState | null;
  providerModelCatalogs: Record<string, ProviderModelsSnapshotData>;
  providerModelErrors: Record<string, ProviderModelsFailedData & { updatedAt: string }>;
  providerModelLoadingIds: Record<string, boolean>;
  onRefreshConfig: () => void;
  onSaveConfig: (config: Record<string, unknown>) => string | null;
  onFetchProviderModels: (providerId: string, force?: boolean, endpoint?: ProviderModelEndpointInput) => void;
}
export interface ChatRuntimeState {
  workspaceId?: string;
  socketStatus: SocketStatus;
  uploadUrl: string;
  uploadCsrfToken?: string;
  /** Latest sandbox runtime snapshot; null until the first sync arrives. */
  sandboxStatus?: SandboxStatusSnapshotData | null;
  activationCatalog?: AgentActivationCatalogSnapshot | null;
}

export interface ChatMessageActions {
  onSend: (
    input: string,
    attachments?: UploadAttachmentData[],
    queueMode?: MessageQueueMode,
    activations?: ExplicitActivationSet,
  ) => boolean;
  onCancel: () => void;
  onForkFromMessage: (message: Pick<ChatMessage, "requestId">) => void;
  onRegenerate: (message: ChatMessage) => void;
  onRetryRun: (message: ChatMessage) => void;
  onContinueRun: (message: ChatMessage) => void;
  onEditUserMessage: (message: ChatMessage, nextContent: string) => void;
  onDeleteFromMessage: (message: ChatMessage) => void;
  onViewWorkflow: (message: ChatMessage) => void;
  onResolveApproval: (approvalId: string, decision: ApprovalDecision) => void;
  onResolveApprovalBatch: (batch: ApprovalBatchReference, decision: ApprovalDecision) => void;
  onResolveInteractionInput: (
    interactionId: string,
    action: InteractionInputAction,
    content?: InteractionInputContent,
  ) => void;
}

export interface ChatNavigationActions {
  onOpenSessionPanel?: () => void;
  onOpenWorkflowPanel?: () => void;
  onRetryHistory?: (sessionId: string) => void;
  onOpenSettings?: (section: SettingsSectionId, returnFocus?: HTMLElement | null) => void;
}

export interface ChatPanelProps {
  userProfile: UserProfile;
  modelConfig: ChatModelConfig;
  runtime: ChatRuntimeState;
  messageActions: ChatMessageActions;
  navigationActions?: ChatNavigationActions;
}
