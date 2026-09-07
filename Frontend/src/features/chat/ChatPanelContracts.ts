import type {
  ConfigMutationState,
  ConfigSnapshotData,
  ModelProviderListItem,
  PersonaPresetCard,
  PresetItem,
  PresetMutationState,
  PresetWorldPackageDescriptor,
  ProviderModelEndpointInput,
  ProviderModelsFailedData,
  ProviderModelsSnapshotData,
  UploadAttachmentData,
  InteractionInputAction,
  InteractionInputContent,
} from "../../api/eventTypes";
import type { SocketStatus } from "../../api/useAgentSocket";
import type { ApprovalBatchReference, ApprovalDecision } from "../../api/approvalEventTypes";
import type { MessageQueueMode } from "../../app/useChatCommands";
import type { ChatMessage, UserProfile } from "../../store/sessionStore";
import type { ExecutionApprovalMode } from "../../api/executionApprovalMode";

export interface ChatModelConfig {
  modelProviders: ModelProviderListItem[];
  selectedModelProviderId: string | null;
  /** Server-configured default used for new conversations. */
  defaultModelProviderId?: string | null;
  onSelectModelProvider: (id: string) => void;
  /** Restores the active conversation to the current default model. */
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
export interface ChatPresetConfig {
  presets: PresetItem[];
  worldPackages: PresetWorldPackageDescriptor[];
  activePresetName: string | null;
  presetsEnabled: boolean;
  presetRootDir: string;
  presetOperations: Record<string, PresetMutationState>;
  onRefreshPresets: () => void;
  onSavePreset: (input: { name: string; card: PersonaPresetCard; activate?: boolean }) => string | null;
  onDeletePreset: (name: string) => string | null;
  onSetActivePreset: (name: string | null) => string | null;
}

export interface ChatRuntimeState {
  socketStatus: SocketStatus;
  uploadUrl: string;
  uploadCsrfToken?: string;
}

export interface ChatMessageActions {
  onSend: (input: string, attachments?: UploadAttachmentData[], queueMode?: MessageQueueMode) => boolean;
  onCancel: () => void;
  onForkFromMessage: (message: Pick<ChatMessage, "requestId">) => void;
  onRegenerate: (message: ChatMessage) => void;
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
}

export interface ChatPanelProps {
  userProfile: UserProfile;
  modelConfig: ChatModelConfig;
  presetConfig: ChatPresetConfig;
  runtime: ChatRuntimeState;
  messageActions: ChatMessageActions;
  navigationActions?: ChatNavigationActions;
}
