import { useMemo } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type {
  ModelProviderListItem,
  ConfigMutationState,
  ConfigSnapshotData,
  PresetFormat,
  PresetItem,
  PresetMutationState,
  ProviderModelEndpointInput,
  ProviderModelsFailedData,
  ProviderModelsSnapshotData,
  PluginConfigItem,
  PluginConfigMutationState,
  UploadAttachmentData,
} from "../../api/eventTypes";
import type { MessageQueueMode } from "../../app/useChatCommands";
import { useStore, type ChatMessage, type UserProfile, DEFAULT_SESSION_TITLE } from "../../store/sessionStore";
import { ChatComposer } from "./ChatComposer";
import { ChatHeader } from "./ChatHeader";
import { EmptyChatState } from "./EmptyChatState";
import { HistoryRecoveryState } from "./HistoryRecoveryState";
import { MessageList } from "./MessageList";
import { readSelectedModelProvider } from "./modelProvider";
import { motionTimings, useMotionLevel, type MotionLevel } from "../../shared/motion";

interface Props {
  modelProviders: ModelProviderListItem[];
  selectedModelProviderId: string | null;
  onSelectModelProvider: (id: string) => void;
  pluginConfigs: PluginConfigItem[];
  pluginConfigOperations: Record<string, PluginConfigMutationState>;
  configSnapshot: ConfigSnapshotData | null;
  configOperation: ConfigMutationState | null;
  providerModelCatalogs: Record<string, ProviderModelsSnapshotData>;
  providerModelErrors: Record<string, ProviderModelsFailedData & { updatedAt: string }>;
  providerModelLoadingIds: Record<string, boolean>;
  presets: PresetItem[];
  activePresetName: string | null;
  presetsEnabled: boolean;
  presetRootDir: string;
  presetOperations: Record<string, PresetMutationState>;
  onRefreshPluginConfigs: () => void;
  onSavePluginConfig: (pluginName: string, toml: string) => string | null;
  onSetPluginEnabled: (pluginName: string, enabled: boolean, toolName?: string) => string | null;
  onRefreshConfig: () => void;
  onSaveConfig: (config: Record<string, unknown>) => string | null;
  onFetchProviderModels: (providerId: string, force?: boolean, endpoint?: ProviderModelEndpointInput) => void;
  onRefreshPresets: () => void;
  onSavePreset: (input: {
    name: string;
    format: PresetFormat;
    content: string;
    activate?: boolean;
  }) => string | null;
  onDeletePreset: (name: string) => string | null;
  onSetActivePreset: (name: string | null) => string | null;
  socketStatus: string;
  uploadUrl: string;
  onSend: (input: string, attachments?: UploadAttachmentData[], queueMode?: MessageQueueMode) => void;
  onCancel: () => void;
  onRegenerate: (message: ChatMessage) => void;
  onEditUserMessage: (message: ChatMessage, nextContent: string) => void;
  onDeleteFromMessage: (message: ChatMessage) => void;
  onViewWorkflow: (message: ChatMessage) => void;
  onResolveApproval: (approvalId: string, status: "approved" | "denied") => void;
  userProfile: UserProfile;
  onOpenSessionPanel?: () => void;
  onOpenWorkflowPanel?: () => void;
  onRetryHistory?: (sessionId: string) => void;
}

export function ChatPanel({
  modelProviders,
  selectedModelProviderId,
  onSelectModelProvider,
  pluginConfigs,
  pluginConfigOperations,
  configSnapshot,
  configOperation,
  providerModelCatalogs,
  providerModelErrors,
  providerModelLoadingIds,
  presets,
  activePresetName,
  presetsEnabled,
  presetRootDir,
  presetOperations,
  onRefreshPluginConfigs,
  onSavePluginConfig,
  onSetPluginEnabled,
  onRefreshConfig,
  onSaveConfig,
  onFetchProviderModels,
  onRefreshPresets,
  onSavePreset,
  onDeletePreset,
  onSetActivePreset,
  socketStatus,
  uploadUrl,
  onSend,
  onCancel,
  onRegenerate,
  onEditUserMessage,
  onDeleteFromMessage,
  onViewWorkflow,
  onResolveApproval,
  userProfile,
  onOpenSessionPanel,
  onOpenWorkflowPanel,
  onRetryHistory,
}: Props): JSX.Element {
  const activeId = useStore((s) => s.activeSessionId);
  const session = useStore((s) => (activeId ? s.sessions[activeId] : null));
  const historyLoading = useStore((s) => (activeId ? !!s.historyLoadingIds[activeId] : false));
  const historyFailed = useStore((s) => (activeId ? !!s.historyFailedIds[activeId] : false));
  const { level, reduceMotion, disableMotion } = useMotionLevel();
  const effectiveMotionLevel = disableMotion ? "none" : reduceMotion ? "reduced" : level;

  const messages = session?.messages ?? [];
  const currentRun = session?.runs[session.runs.length - 1];
  const isRunning = currentRun?.status === "running";
  const composerDisabled = socketStatus !== "open" || historyLoading;
  const shouldShowHistoryRecovery =
    messages.length === 0 &&
    !isRunning &&
    !!session &&
    session.messageCount > 0 &&
    (historyLoading || historyFailed);
  const assistantAvatarIcon = useMemo(
    () => readSelectedModelProvider(modelProviders, selectedModelProviderId)?.icon,
    [modelProviders, selectedModelProviderId],
  );
  const selectedModelProvider = useMemo(
    () => readSelectedModelProvider(modelProviders, selectedModelProviderId),
    [modelProviders, selectedModelProviderId],
  );

  return (
    <main className="flex h-full min-w-0 flex-1 flex-col bg-paper-50">
      <ChatHeader
        title={session?.title ?? DEFAULT_SESSION_TITLE}
        runStatus={currentRun?.status}
        onOpenSessionPanel={onOpenSessionPanel}
        onOpenWorkflowPanel={onOpenWorkflowPanel}
      />
      <AnimatePresence mode="wait" initial={false}>
        {shouldShowHistoryRecovery ? (
          <ChatContentMotion key={`history:${activeId}:${historyFailed ? "failed" : "loading"}`} motionLevel={effectiveMotionLevel}>
            <HistoryRecoveryState
              failed={historyFailed}
              messageCount={session.messageCount}
              onRetry={activeId && onRetryHistory ? () => onRetryHistory(activeId) : undefined}
              retryDisabled={socketStatus !== "open"}
            />
          </ChatContentMotion>
        ) : messages.length === 0 && !isRunning ? (
          <ChatContentMotion key={`empty:${activeId ?? "none"}`} motionLevel={effectiveMotionLevel}>
            <div className="flex flex-1 items-center justify-center px-6">
              <EmptyChatState
                onSelectSuggestion={socketStatus === "open" ? onSend : undefined}
              />
            </div>
          </ChatContentMotion>
        ) : (
          <ChatContentMotion key={`messages:${activeId ?? "none"}`} motionLevel={effectiveMotionLevel}>
            <MessageList
              sessionId={session?.sessionId ?? activeId ?? ""}
              messages={messages}
              runs={session?.runs ?? []}
              currentRun={isRunning ? currentRun : undefined}
              assistantAvatarIcon={assistantAvatarIcon}
              selectedModelProvider={selectedModelProvider}
              userProfile={userProfile}
              onRegenerate={onRegenerate}
              onEditUserMessage={onEditUserMessage}
              onDeleteFromMessage={onDeleteFromMessage}
              onViewWorkflow={onViewWorkflow}
              onResolveApproval={onResolveApproval}
              approvalDisabled={socketStatus !== "open"}
            />
          </ChatContentMotion>
        )}
      </AnimatePresence>
      <ChatComposer
        disabled={composerDisabled}
        running={!!isRunning}
        modelProviders={modelProviders}
        selectedModelProviderId={selectedModelProviderId}
        onSelectModelProvider={onSelectModelProvider}
        pluginConfigs={pluginConfigs}
        pluginConfigOperations={pluginConfigOperations}
        configSnapshot={configSnapshot}
        configOperation={configOperation}
        providerModelCatalogs={providerModelCatalogs}
        providerModelErrors={providerModelErrors}
        providerModelLoadingIds={providerModelLoadingIds}
        presets={presets}
        activePresetName={activePresetName}
        presetsEnabled={presetsEnabled}
        presetRootDir={presetRootDir}
        presetOperations={presetOperations}
        onRefreshPluginConfigs={onRefreshPluginConfigs}
        onSavePluginConfig={onSavePluginConfig}
        onSetPluginEnabled={onSetPluginEnabled}
        onRefreshConfig={onRefreshConfig}
        onSaveConfig={onSaveConfig}
        onFetchProviderModels={onFetchProviderModels}
        onRefreshPresets={onRefreshPresets}
        onSavePreset={onSavePreset}
        onDeletePreset={onDeletePreset}
        onSetActivePreset={onSetActivePreset}
        socketStatus={socketStatus}
        uploadUrl={uploadUrl}
        onSend={onSend}
        onCancel={onCancel}
      />
    </main>
  );
}

function ChatContentMotion({
  children,
  motionLevel,
}: {
  children: JSX.Element;
  motionLevel: MotionLevel;
}): JSX.Element {
  return (
    <motion.div
      className="flex min-h-0 flex-1 flex-col"
      initial={motionLevel === "none" ? false : "hidden"}
      animate="show"
      exit="exit"
      variants={readChatContentVariants(motionLevel)}
      transition={motionLevel === "none" ? { duration: 0 } : motionTimings.base}
    >
      {children}
    </motion.div>
  );
}

function readChatContentVariants(level: MotionLevel) {
  if (level === "none") {
    return {
      hidden: { opacity: 1 },
      show: { opacity: 1 },
      exit: { opacity: 1 },
    };
  }
  if (level === "reduced") {
    return {
      hidden: { opacity: 0 },
      show: { opacity: 1 },
      exit: { opacity: 0 },
    };
  }
  return {
    hidden: { opacity: 0, y: 8 },
    show: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: -4 },
  };
}
