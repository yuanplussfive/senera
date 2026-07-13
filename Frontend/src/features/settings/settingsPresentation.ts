import type { SettingsSectionRuntimeStatus } from "./settingsInteractionModel";
import type { SettingsSectionDefinition, SettingsSectionId } from "./types";

export type SettingsSectionStatus = "configurable" | "planned";

export interface SettingsSectionPlan {
  title: string;
  items: string[];
}

export type SettingsSectionGroupId = "model" | "experience" | "runtime" | "planned" | "support" | "other";

export interface SettingsSectionGroupDefinition {
  id: SettingsSectionGroupId;
  label: string;
  description: string;
  sectionIds: readonly SettingsSectionId[];
}

export interface SettingsDiagnosticRow {
  label: string;
  value: string;
}

export interface SettingsDiagnosticInput {
  appVersion: string;
  frontendVersion: string;
  mode: string;
  isDesktop: boolean;
  section: SettingsSectionId;
}

export interface SettingsSectionSearchDetail {
  label: string;
  value: string;
}

export interface SettingsSectionSearchResult {
  section: SettingsSectionDefinition;
  details: SettingsSectionSearchDetail[];
}

export interface GroupedSettingsSectionSearchResult {
  group: SettingsSectionGroupDefinition;
  results: SettingsSectionSearchResult[];
}

export type SettingsWorkbenchActionKind = "config" | "none";
export type SettingsWorkbenchSummaryTone = "neutral" | "success" | "info" | "warning" | "danger";

export interface SettingsWorkbenchSectionSummary {
  actionSurfaceDetail: string;
  actionSurfaceLabel: string;
  actionKind: SettingsWorkbenchActionKind;
  disabledReason: string | null;
  groupDescription: string;
  groupLabel: string;
  nextStepDetail: string;
  nextStepLabel: string;
  runtimeSurfaceDetail: string;
  runtimeSurfaceLabel: string;
  runtimeSurfaceTone: SettingsWorkbenchSummaryTone;
  saveModelDetail: string;
  saveModelLabel: string;
  statusDetail: string;
  statusLabel: string;
  statusTone: SettingsWorkbenchSummaryTone;
}

export const settingsSectionGroups = [
  {
    id: "model",
    label: "模型服务",
    description: "供应商连接、模型目录和模型参数。",
    sectionIds: ["model-service", "default-model"],
  },
  {
    id: "experience",
    label: "体验",
    description: "窗口、布局和外观偏好。",
    sectionIds: ["general", "appearance"],
  },
  {
    id: "runtime",
    label: "运行能力",
    description: "系统配置、运行能力和技能。",
    sectionIds: ["system", "runtime", "planning", "retrieval", "storage", "skills"],
  },
  {
    id: "planned",
    label: "规划中",
    description: "尚未迁移到设置工作台的设置域。",
    sectionIds: ["tools", "memory", "integrations", "usage"],
  },
  {
    id: "support",
    label: "支持",
    description: "版本、诊断和本地验证线索。",
    sectionIds: ["about"],
  },
] as const satisfies readonly SettingsSectionGroupDefinition[];

export function searchSettingsSections(
  sections: readonly SettingsSectionDefinition[],
  query: string,
): SettingsSectionDefinition[] {
  return searchSettingsSectionResults(sections, query).map((result) => result.section);
}

export function groupSettingsSectionResults(
  results: readonly SettingsSectionSearchResult[],
): GroupedSettingsSectionSearchResult[] {
  const resultsBySection = new Map(results.map((result) => [result.section.id, result]));
  const groupedIds = new Set<SettingsSectionId>(settingsSectionGroups.flatMap((group) => group.sectionIds));
  const groupedResults = settingsSectionGroups.flatMap((group) => {
    const groupResults = group.sectionIds.flatMap((sectionId) => {
      const result = resultsBySection.get(sectionId);
      return result ? [result] : [];
    });
    return groupResults.length > 0 ? [{ group, results: groupResults }] : [];
  });
  const ungroupedResults = results.filter((result) => !groupedIds.has(result.section.id));

  if (ungroupedResults.length === 0) {
    return groupedResults;
  }

  return [
    ...groupedResults,
    {
      group: fallbackSettingsSectionGroup,
      results: ungroupedResults,
    },
  ];
}

export function readSettingsSectionGroup(sectionId: SettingsSectionId): SettingsSectionGroupDefinition {
  return settingsSectionGroups.find((group) => sectionGroupIncludes(group, sectionId)) ?? fallbackSettingsSectionGroup;
}

export function searchSettingsSectionResults(
  sections: readonly SettingsSectionDefinition[],
  query: string,
): SettingsSectionSearchResult[] {
  const tokens = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);

  if (tokens.length === 0) {
    return sections.map((section) => ({
      section,
      details: [],
    }));
  }

  return sections.flatMap((section) => {
    const entries = createSettingsSectionSearchEntries(section);
    const searchText = entries
      .map((entry) => entry.searchText)
      .join(" ")
      .toLocaleLowerCase();
    if (!tokens.every((token) => searchText.includes(token))) {
      return [];
    }

    return [
      {
        section,
        details: createSettingsSectionSearchDetails(entries, tokens),
      },
    ];
  });
}

const configurableSections = new Set<SettingsSectionId>([
  "general",
  "appearance",
  "system",
  "model-service",
  "default-model",
  "runtime",
  "planning",
  "retrieval",
  "storage",
  "skills",
  "about",
]);

const plannedSectionPlans: Partial<Record<SettingsSectionId, SettingsSectionPlan>> = {
  tools: {
    title: "工具会迁入这里",
    items: ["工具权限", "调用确认策略", "运行安全边界"],
  },
  memory: {
    title: "记忆会迁入这里",
    items: ["记忆策略", "召回范围", "学习开关"],
  },
  integrations: {
    title: "集成会迁入这里",
    items: ["搜索服务", "外部工具", "运行环境"],
  },
  usage: {
    title: "用量会迁入这里",
    items: ["调用统计", "token 汇总", "运行耗时"],
  },
};

const fallbackSettingsSectionGroup: SettingsSectionGroupDefinition = {
  id: "other",
  label: "其他",
  description: "未归类的设置入口。",
  sectionIds: [],
};

function sectionGroupIncludes(group: SettingsSectionGroupDefinition, sectionId: SettingsSectionId): boolean {
  return group.sectionIds.includes(sectionId);
}

export function readSettingsSectionStatus(sectionId: SettingsSectionId): SettingsSectionStatus {
  return configurableSections.has(sectionId) ? "configurable" : "planned";
}

export function readSettingsSectionPlan(sectionId: SettingsSectionId): SettingsSectionPlan {
  return (
    plannedSectionPlans[sectionId] ?? {
      title: "这个分区会继续扩展",
      items: ["配置入口", "状态摘要", "验证动作"],
    }
  );
}

export function readSettingsWorkbenchSectionSummary(
  section: SettingsSectionDefinition,
  runtimeStatus?: SettingsSectionRuntimeStatus,
): SettingsWorkbenchSectionSummary {
  const group = readSettingsSectionGroup(section.id);
  const sectionStatus = readSettingsSectionStatus(section.id);

  if (sectionStatus === "planned") {
    const plan = readSettingsSectionPlan(section.id);
    return {
      actionSurfaceDetail: "迁移完成前不会打开空白设置页。",
      actionSurfaceLabel: "暂不可操作",
      actionKind: "none",
      disabledReason: "仍处于 legacy compatibility（旧版兼容）阶段，完整功能迁移前不会打开空白设置页。",
      groupDescription: group.description,
      groupLabel: group.label,
      nextStepDetail: plan.items.join(" / "),
      nextStepLabel: "等待能力规格",
      runtimeSurfaceDetail: "迁移完成前继续保留在 legacy compatibility（旧版兼容）路径。",
      runtimeSurfaceLabel: "暂未开放",
      runtimeSurfaceTone: "neutral",
      saveModelDetail: plan.title,
      saveModelLabel: "迁移前置",
      statusDetail: "这个分区仍不可点击，现有完整功能暂时保留在原入口。",
      statusLabel: "规划中",
      statusTone: "neutral",
    };
  }

  switch (section.id) {
    case "system":
    case "model-service":
      return createConfigBackedWorkbenchSummary(section.id, group, runtimeStatus);
    case "default-model":
      return createDefaultModelWorkbenchSummary(group, runtimeStatus);
    case "runtime":
    case "planning":
    case "retrieval":
    case "storage":
      return createConfigFormSectionWorkbenchSummary({
        group,
        runtimeStatus,
        sectionLabel: section.label,
        sectionName: section.id,
        scopeDetail: section.description,
      });
    case "skills":
      return createSkillsWorkbenchSummary(group, runtimeStatus);
    case "appearance":
      return {
        actionSurfaceDetail: "外观修改会即时应用，没有额外保存按钮。",
        actionSurfaceLabel: "即时应用",
        actionKind: "none",
        disabledReason: null,
        groupDescription: group.description,
        groupLabel: group.label,
        nextStepDetail: "调整后会同步到已打开的 Senera 窗口。",
        nextStepLabel: "直接调整偏好",
        runtimeSurfaceDetail: "外观偏好通过本地主题状态同步到已打开窗口。",
        runtimeSurfaceLabel: "本地偏好",
        runtimeSurfaceTone: "success",
        saveModelDetail: "主题、强调色、字体和字号选择会即时应用。",
        saveModelLabel: "即时应用",
        statusDetail: "外观偏好由本地主题偏好管理。",
        statusLabel: "可配置",
        statusTone: "success",
      };
    case "general":
      return {
        actionSurfaceDetail: "布局和动画偏好由本地偏好保存。",
        actionSurfaceLabel: "本地偏好",
        actionKind: "none",
        disabledReason: null,
        groupDescription: group.description,
        groupLabel: group.label,
        nextStepDetail: "切换布局和动画偏好会立即反映到设置窗口。",
        nextStepLabel: "直接调整偏好",
        runtimeSurfaceDetail: "通用偏好不依赖主配置快照，修改后直接保存在本地。",
        runtimeSurfaceLabel: "本地偏好",
        runtimeSurfaceTone: "success",
        saveModelDetail: "窗口布局和交互偏好使用本地偏好保存。",
        saveModelLabel: "本地偏好",
        statusDetail: "通用设置已接入 SettingsWorkbench（设置工作台）。",
        statusLabel: "可配置",
        statusTone: "success",
      };
    case "about":
      return {
        actionSurfaceDetail: "关于页只读取运行信息，不提供保存动作。",
        actionSurfaceLabel: "只读诊断",
        actionKind: "none",
        disabledReason: null,
        groupDescription: group.description,
        groupLabel: group.label,
        nextStepDetail: "需要验证时复制本地命令，或检查当前运行表面。",
        nextStepLabel: "查看诊断线索",
        runtimeSurfaceDetail: "只读取版本、运行模式和本地验证入口。",
        runtimeSurfaceLabel: "诊断视图",
        runtimeSurfaceTone: "neutral",
        saveModelDetail: "关于页只读取版本、运行模式和本地验证入口。",
        saveModelLabel: "只读诊断",
        statusDetail: "用于确认当前桌面或浏览器设置表面。",
        statusLabel: "可查看",
        statusTone: "neutral",
      };
    default:
      return {
        actionSurfaceDetail: "这个分区的操作位置会随后续规格定义。",
        actionSurfaceLabel: "待定义",
        actionKind: "none",
        disabledReason: null,
        groupDescription: group.description,
        groupLabel: group.label,
        nextStepDetail: "继续补齐设置分区状态和操作。",
        nextStepLabel: "继续扩展",
        runtimeSurfaceDetail: group.description,
        runtimeSurfaceLabel: "待定义",
        runtimeSurfaceTone: "neutral",
        saveModelDetail: "保存模型尚未单独定义。",
        saveModelLabel: "待定义",
        statusDetail: section.description,
        statusLabel: runtimeStatus?.label ?? "可配置",
        statusTone: readRuntimeStatusTone(runtimeStatus),
      };
  }
}

export function createSettingsDiagnostics(input: SettingsDiagnosticInput): SettingsDiagnosticRow[] {
  return [
    { label: "应用版本", value: input.appVersion },
    { label: "前端版本", value: input.frontendVersion },
    { label: "运行模式", value: input.mode },
    { label: "运行表面", value: input.isDesktop ? "Electron 桌面端" : "浏览器前端" },
    { label: "当前分区", value: input.section },
  ];
}

function createConfigBackedWorkbenchSummary(
  sectionId: Extract<SettingsSectionId, "system" | "model-service">,
  group: SettingsSectionGroupDefinition,
  runtimeStatus?: SettingsSectionRuntimeStatus,
): SettingsWorkbenchSectionSummary {
  const statusLabel = runtimeStatus?.label ?? "等待配置";
  const statusDetailByState: Partial<Record<SettingsSectionRuntimeStatus["state"], string>> = {
    dirty: "有未保存修改，保存后才会写入主配置。",
    error: "存在配置或校验错误，保存前需要修复。",
    idle: "正在等待主配置快照或运行状态。",
    saving: "正在把当前草稿保存到后端配置。",
    synced: "主配置草稿和后端快照已同步。",
  };
  const nextStepByState: Partial<Record<SettingsSectionRuntimeStatus["state"], string>> = {
    dirty: "在工作区保存或还原",
    error: "在工作区修复后保存",
    idle: "等待配置加载",
    saving: "等待保存完成",
    synced: "在工作区继续编辑",
  };

  if (sectionId === "model-service") {
    const modelServiceStatusDetailByState: Partial<Record<SettingsSectionRuntimeStatus["state"], string>> = {
      dirty: "模型服务有待处理的连接或模型操作。",
      error: "模型服务存在连接或模型操作错误。",
      idle: "正在等待模型服务快照或运行状态。",
      saving: "正在处理模型服务操作。",
      synced: "模型服务连接和模型状态已同步。",
    };
    const modelServiceNextStepByState: Partial<Record<SettingsSectionRuntimeStatus["state"], string>> = {
      dirty: "检查当前操作状态",
      error: "检查连接或模型错误",
      idle: "等待配置加载",
      saving: "等待操作完成",
      synced: "在工作区继续管理",
    };
    return {
      actionSurfaceDetail: "供应商连接和模型改动会立即保存，不再经过整份配置草稿。",
      actionSurfaceLabel: "在模型服务中即时保存",
      actionKind: "none",
      disabledReason: null,
      groupDescription: group.description,
      groupLabel: group.label,
      nextStepDetail: "打开模型服务，选择供应商后即可编辑连接、拉取模型和管理已配置模型。",
      nextStepLabel: runtimeStatus
        ? (modelServiceNextStepByState[runtimeStatus.state] ?? "检查配置状态")
        : "等待配置加载",
      runtimeSurfaceDetail: "模型服务读取主配置快照，但连接和模型改动通过独立命令即时持久化。",
      runtimeSurfaceLabel: runtimeStatus && runtimeStatus.state !== "idle" ? "配置已连接" : "等待配置",
      runtimeSurfaceTone: runtimeStatus && runtimeStatus.state !== "idle" ? "success" : "neutral",
      saveModelDetail: "每次供应商连接保存或模型增删都会单独发起保存请求，不再等待整份配置保存。",
      saveModelLabel: "按项即时保存",
      statusDetail: runtimeStatus
        ? (modelServiceStatusDetailByState[runtimeStatus.state] ?? "当前分区已接入模型服务运行状态。")
        : "主配置快照加载后会显示模型服务状态。",
      statusLabel,
      statusTone: readRuntimeStatusTone(runtimeStatus),
    };
  }

  return {
    actionSurfaceDetail: "刷新、还原和保存由下方主配置工作区处理。",
    actionSurfaceLabel: "在配置工作区保存",
    actionKind: "config",
    disabledReason: null,
    groupDescription: group.description,
    groupLabel: group.label,
    nextStepDetail: "主配置仅负责系统级字段；运行、规划、检索和存储在各自分区编辑。",
    nextStepLabel: runtimeStatus ? (nextStepByState[runtimeStatus.state] ?? "检查配置状态") : "等待配置加载",
    runtimeSurfaceDetail: "主配置表单从配置快照读取，并复用共享草稿和保存动作。",
    runtimeSurfaceLabel: runtimeStatus && runtimeStatus.state !== "idle" ? "配置已连接" : "等待配置",
    runtimeSurfaceTone: runtimeStatus && runtimeStatus.state !== "idle" ? "success" : "neutral",
    saveModelDetail: "主配置使用共享草稿保存；供应商和模型通过模型服务的独立命令即时持久化。",
    saveModelLabel: "主配置草稿",
    statusDetail: runtimeStatus
      ? (statusDetailByState[runtimeStatus.state] ?? "当前分区已接入主配置运行状态。")
      : "主配置快照加载后会显示保存和校验状态。",
    statusLabel,
    statusTone: readRuntimeStatusTone(runtimeStatus),
  };
}

function createDefaultModelWorkbenchSummary(
  group: SettingsSectionGroupDefinition,
  runtimeStatus?: SettingsSectionRuntimeStatus,
): SettingsWorkbenchSectionSummary {
  return {
    actionSurfaceDetail: "选择默认助手模型后立即调用默认模型命令保存。",
    actionSurfaceLabel: "即时保存",
    actionKind: "none",
    disabledReason: null,
    groupDescription: group.description,
    groupLabel: group.label,
    nextStepDetail: "候选项仅包含已配置、已启用供应商提供的聊天模型。",
    nextStepLabel: runtimeStatus?.state === "error" ? "检查默认模型错误" : "选择默认助手模型",
    runtimeSurfaceDetail: "默认模型选择通过 provider.defaultModel.set 独立持久化，不占用配置草稿。",
    runtimeSurfaceLabel: runtimeStatus?.state === "error" ? "需要修复" : "即时命令",
    runtimeSurfaceTone: readRuntimeStatusTone(runtimeStatus),
    saveModelDetail: "模型选择成功后由后端快照确认当前默认助手模型。",
    saveModelLabel: "即时保存",
    statusDetail:
      runtimeStatus?.state === "error"
        ? "默认模型命令返回错误，请检查模型服务和供应商状态。"
        : "默认助手模型由模型服务配置提供。",
    statusLabel: runtimeStatus?.label ?? "可配置",
    statusTone: readRuntimeStatusTone(runtimeStatus),
  };
}

function createConfigFormSectionWorkbenchSummary({
  group,
  runtimeStatus,
  sectionLabel,
  sectionName,
  scopeDetail,
}: {
  group: SettingsSectionGroupDefinition;
  runtimeStatus?: SettingsSectionRuntimeStatus;
  sectionLabel: string;
  sectionName: Extract<SettingsSectionId, "runtime" | "planning" | "retrieval" | "storage">;
  scopeDetail: string;
}): SettingsWorkbenchSectionSummary {
  const statusLabel = runtimeStatus?.label ?? "等待配置";
  const statusDetailByState: Partial<Record<SettingsSectionRuntimeStatus["state"], string>> = {
    dirty: "有未保存修改，保存后才会写入主配置。",
    error: "存在配置或校验错误，保存前需要修复。",
    idle: "正在等待主配置快照或运行状态。",
    saving: "正在把当前草稿保存到后端配置。",
    synced: "主配置草稿和后端快照已同步。",
  };
  const nextStepByState: Partial<Record<SettingsSectionRuntimeStatus["state"], string>> = {
    dirty: "在工作区保存或还原",
    error: "在工作区修复后保存",
    idle: "等待配置加载",
    saving: "等待保存完成",
    synced: "在工作区继续编辑",
  };

  return {
    actionSurfaceDetail: `${sectionLabel}使用当前配置草稿保存。`,
    actionSurfaceLabel: `保存${sectionLabel}`,
    actionKind: "config",
    disabledReason: null,
    groupDescription: group.description,
    groupLabel: group.label,
    nextStepDetail: scopeDetail,
    nextStepLabel: runtimeStatus ? (nextStepByState[runtimeStatus.state] ?? "检查配置状态") : "等待配置加载",
    runtimeSurfaceDetail: `${sectionName} 配置表单从主配置快照中读取，并复用主配置保存动作。`,
    runtimeSurfaceLabel: runtimeStatus && runtimeStatus.state !== "idle" ? "配置已连接" : "等待配置",
    runtimeSurfaceTone: runtimeStatus && runtimeStatus.state !== "idle" ? "success" : "neutral",
    saveModelDetail: "当前仍复用主配置保存契约；这里只改变入口边界和可见范围。",
    saveModelLabel: "配置草稿",
    statusDetail: runtimeStatus
      ? (statusDetailByState[runtimeStatus.state] ?? "当前分区已接入主配置运行状态。")
      : "主配置快照加载后会显示保存和校验状态。",
    statusLabel,
    statusTone: readRuntimeStatusTone(runtimeStatus),
  };
}

function createSkillsWorkbenchSummary(
  group: SettingsSectionGroupDefinition,
  runtimeStatus?: SettingsSectionRuntimeStatus,
): SettingsWorkbenchSectionSummary {
  return {
    actionSurfaceDetail: "保存、启用和工具开关由技能详情处理。",
    actionSurfaceLabel: "插件操作",
    actionKind: "none",
    disabledReason: null,
    groupDescription: group.description,
    groupLabel: group.label,
    nextStepDetail: "后续会和 tools（工具）能力边界一起重做最终交互。",
    nextStepLabel:
      runtimeStatus?.state === "error"
        ? "查看插件诊断"
        : runtimeStatus?.state === "needs_attention"
          ? "补齐插件配置"
          : "管理技能配置",
    runtimeSurfaceDetail: "技能通过 plugin operations（插件操作）单独保存，不占用主配置草稿。",
    runtimeSurfaceLabel: runtimeStatus ? "插件通道" : "等待插件",
    runtimeSurfaceTone: readRuntimeStatusTone(runtimeStatus),
    saveModelDetail: "技能配置通过 plugin operations（插件操作）单独保存。",
    saveModelLabel: "插件操作",
    statusDetail: runtimeStatus ? "技能分区显示插件加载、诊断和配置需求。" : "等待插件配置状态。",
    statusLabel: runtimeStatus?.label ?? "等待插件",
    statusTone: readRuntimeStatusTone(runtimeStatus),
  };
}

function readRuntimeStatusTone(runtimeStatus?: SettingsSectionRuntimeStatus): SettingsWorkbenchSummaryTone {
  switch (runtimeStatus?.state) {
    case "dirty":
    case "needs_attention":
      return "warning";
    case "error":
      return "danger";
    case "saving":
      return "info";
    case "synced":
      return "success";
    case "idle":
    default:
      return "neutral";
  }
}

interface SettingsSectionSearchEntry {
  detailLabel: string;
  rank: number;
  searchText: string;
  value: string;
}

function createSettingsSectionSearchEntries(section: SettingsSectionDefinition): SettingsSectionSearchEntry[] {
  const status = readSettingsSectionStatus(section.id);
  const entries: SettingsSectionSearchEntry[] = [
    {
      detailLabel: "标题",
      rank: 0,
      searchText: section.label,
      value: section.label,
    },
    {
      detailLabel: "描述",
      rank: 1,
      searchText: section.description,
      value: section.description,
    },
    {
      detailLabel: "ID",
      rank: 2,
      searchText: section.id,
      value: section.id,
    },
    {
      detailLabel: "状态",
      rank: 3,
      searchText: status === "planned" ? "planned disabled 规划中 禁用" : "configurable enabled 已启用",
      value: status === "planned" ? "规划中" : "已启用",
    },
  ];

  if (status === "planned") {
    const plan = readSettingsSectionPlan(section.id);
    entries.push({
      detailLabel: "规划",
      rank: 4,
      searchText: plan.title,
      value: plan.title,
    });
    entries.push(
      ...plan.items.map((item, index) => ({
        detailLabel: "规划",
        rank: 5 + index,
        searchText: item,
        value: item,
      })),
    );
  }

  return entries;
}

function createSettingsSectionSearchDetails(
  entries: readonly SettingsSectionSearchEntry[],
  tokens: readonly string[],
): SettingsSectionSearchDetail[] {
  return entries
    .map((entry) => ({
      entry,
      matchCount: tokens.filter((token) => entry.searchText.toLocaleLowerCase().includes(token)).length,
    }))
    .filter(({ matchCount }) => matchCount > 0)
    .sort((a, b) => b.matchCount - a.matchCount || a.entry.rank - b.entry.rank)
    .slice(0, 2)
    .map(({ entry }) => ({
      label: entry.detailLabel,
      value: entry.value,
    }));
}
