import type {
  ConfigMutationState,
  ConfigSnapshotData,
  SandboxStatusSnapshotData,
  ModelProviderListItem,
  PresetFormat,
  PresetItem,
  PresetMutationState,
  ProviderModelEndpointInput,
  ProviderModelsFailedData,
  ProviderModelsSnapshotData,
  PluginConfigItem,
  PluginConfigMutationState,
  UploadAttachmentData,
  InteractionInputAction,
  InteractionInputContent,
} from "../../api/eventTypes";
import type { SocketStatus } from "../../api/useAgentSocket";
import type { ApprovalDecision } from "../../api/approvalEventTypes";
import type { MessageQueueMode } from "../../app/useChatCommands";
import type { ChatMessage, UserProfile } from "../../store/sessionStore";

export interface ChatModelConfig {
  modelProviders: ModelProviderListItem[];
  selectedModelProviderId: string | null;
  /** Server-configured default used for new conversations. */
  defaultModelProviderId?: string | null;
  onSelectModelProvider: (id: string) => void;
  /** Restores the active conversation to the current default model. */
  onApplyDefaultModel?: () => void;
}

export interface ChatPluginConfig {
  pluginConfigs: PluginConfigItem[];
  pluginConfigOperations: Record<string, PluginConfigMutationState>;
  onRefreshPluginConfigs: () => void;
  onSavePluginConfig: (pluginName: string, toml: string) => string | null;
  onSetPluginEnabled: (pluginName: string, enabled: boolean, toolName?: string) => string | null;
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
  activePresetName: string | null;
  presetsEnabled: boolean;
  presetRootDir: string;
  presetOperations: Record<string, PresetMutationState>;
  onRefreshPresets: () => void;
  onSavePreset: (input: { name: string; format: PresetFormat; content: string; activate?: boolean }) => string | null;
  onDeletePreset: (name: string) => string | null;
  onSetActivePreset: (name: string | null) => string | null;
}

export interface ChatRuntimeState {
  socketStatus: SocketStatus;
  uploadUrl: string;
  uploadCsrfToken?: string;
  sandboxStatus?: SandboxStatusSnapshotData | null;
}

export interface ChatMessageActions {
  onSend: (input: string, attachments?: UploadAttachmentData[], queueMode?: MessageQueueMode) => boolean;
  onCancel: () => void;
  onForkFromMessage: (message: ChatMessage) => void;
  onRegenerate: (message: ChatMessage) => void;
  onEditUserMessage: (message: ChatMessage, nextContent: string) => void;
  onDeleteFromMessage: (message: ChatMessage) => void;
  onViewWorkflow: (message: ChatMessage) => void;
  onResolveApproval: (approvalId: string, decision: ApprovalDecision) => void;
  onResolveInteractionInput: (
    interactionId: string,
    action: InteractionInputAction,
    content?: InteractionInputContent,
  ) => void;
}

export interface ChatNavigationActions {
  onOpenSessionPanel?: () => void;
  onOpenWorkflowPanel?: () => void;
  onOpenTerminalPanel?: () => void;
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
