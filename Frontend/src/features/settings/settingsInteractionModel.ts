export type SettingsDraftStatus = "loading" | "saving" | "invalid" | "dirty" | "synced";

export type SettingsDraftTone = "neutral" | "success" | "info" | "warning";

export type SettingsSectionRuntimeState = "idle" | "synced" | "dirty" | "saving" | "needs_attention" | "error";

export interface SettingsSectionRuntimeStatus {
  label: string;
  state: SettingsSectionRuntimeState;
}

export interface SettingsDraftInteractionInput {
  dirty: boolean;
  localError?: string | null;
  ready?: boolean;
  saving: boolean;
  validationErrors?: readonly string[];
}

export interface SettingsDraftInteraction {
  detail: string;
  refreshDisabled: boolean;
  refreshLabel: "刷新" | "还原";
  refreshTitle: string;
  saveDisabled: boolean;
  saveTitle: string;
  status: SettingsDraftStatus;
  statusLabel: string;
  tone: SettingsDraftTone;
}

export function readSettingsDraftInteraction({
  dirty,
  localError = null,
  ready = true,
  saving,
  validationErrors = [],
}: SettingsDraftInteractionInput): SettingsDraftInteraction {
  const validationError = validationErrors[0] ?? null;
  const issue = validationError ?? localError;
  const refreshLabel = dirty ? "还原" : "刷新";
  const refreshTitle = dirty ? "放弃未保存修改并还原当前快照" : "刷新配置快照";

  if (!ready) {
    return {
      detail: "配置快照尚未加载。",
      refreshDisabled: true,
      refreshLabel,
      refreshTitle: "配置快照尚未加载",
      saveDisabled: true,
      saveTitle: "配置快照尚未加载",
      status: "loading",
      statusLabel: "等待加载",
      tone: "neutral",
    };
  }

  if (saving) {
    return {
      detail: "正在把当前草稿保存到后端配置。",
      refreshDisabled: true,
      refreshLabel,
      refreshTitle: "正在保存，暂不能刷新或还原",
      saveDisabled: true,
      saveTitle: "正在保存",
      status: "saving",
      statusLabel: "保存中",
      tone: "info",
    };
  }

  if (issue) {
    const blocksSave = Boolean(validationError);
    return {
      detail: issue,
      refreshDisabled: false,
      refreshLabel,
      refreshTitle,
      saveDisabled: blocksSave || !dirty,
      saveTitle: blocksSave ? `请先修复校验错误：${issue}` : dirty ? "重试保存当前草稿" : "没有未保存修改",
      status: "invalid",
      statusLabel: "需要修复",
      tone: "warning",
    };
  }

  if (dirty) {
    return {
      detail: "有未保存修改，保存后才会写入配置。",
      refreshDisabled: false,
      refreshLabel,
      refreshTitle,
      saveDisabled: false,
      saveTitle: "保存当前草稿",
      status: "dirty",
      statusLabel: "未保存",
      tone: "info",
    };
  }

  return {
    detail: "没有未保存修改。",
    refreshDisabled: false,
    refreshLabel,
    refreshTitle,
    saveDisabled: true,
    saveTitle: "没有未保存修改",
    status: "synced",
    statusLabel: "已同步",
    tone: "success",
  };
}

export function readConfigSectionRuntimeStatus(
  input: SettingsDraftInteractionInput & { ready?: boolean },
): SettingsSectionRuntimeStatus | null {
  const interaction = readSettingsDraftInteraction(input);
  switch (interaction.status) {
    case "loading":
      return { label: "加载中", state: "idle" };
    case "saving":
      return { label: "保存中", state: "saving" };
    case "invalid":
      return { label: "需修复", state: "error" };
    case "dirty":
      return { label: "未保存", state: "dirty" };
    case "synced":
      return { label: "已同步", state: "synced" };
  }
}

export function readPluginSectionRuntimeStatus({
  operationStatuses,
  pluginErrors,
  pluginsLoaded,
  pluginsNeedingConfig,
}: {
  operationStatuses: readonly string[];
  pluginErrors: number;
  pluginsLoaded: boolean;
  pluginsNeedingConfig: number;
}): SettingsSectionRuntimeStatus | null {
  if (operationStatuses.includes("pending")) {
    return { label: "保存中", state: "saving" };
  }
  if (operationStatuses.includes("error") || pluginErrors > 0) {
    return { label: "有错误", state: "error" };
  }
  if (pluginsNeedingConfig > 0) {
    return { label: "需配置", state: "needs_attention" };
  }
  if (!pluginsLoaded) {
    return { label: "加载中", state: "idle" };
  }
  return { label: "已同步", state: "synced" };
}
