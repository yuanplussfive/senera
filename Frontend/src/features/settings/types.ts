import {
  Bot,
  Boxes,
  FolderCog,
  Gauge,
  Info,
  Palette,
  Route,
  Search,
  SlidersHorizontal,
  type LucideIcon,
} from "lucide-react";

export type SettingsSectionId =
  | "model-service"
  | "default-model"
  | "runtime"
  | "planning"
  | "retrieval"
  | "skills"
  | "general"
  | "appearance"
  | "system"
  | "storage"
  | "about";

export interface SettingsSectionDefinition {
  id: SettingsSectionId;
  label: string;
  icon: LucideIcon;
  description: string;
}

export const settingsSections = [
  {
    id: "model-service",
    label: "模型服务",
    icon: Bot,
    description: "管理供应商连接、模型列表和模型参数。",
  },
  {
    id: "default-model",
    label: "默认模型",
    icon: Bot,
    description: "选择当前运行时使用的默认助手模型。",
  },
  {
    id: "runtime",
    label: "运行",
    icon: Gauge,
    description: "管理主循环、工具执行、服务和持久化。",
  },
  {
    id: "planning",
    label: "规划与学习",
    icon: Route,
    description: "管理规划、工具学习和长期记忆晋升。",
  },
  {
    id: "retrieval",
    label: "检索与向量",
    icon: Search,
    description: "管理工具检索、向量模型和重排序。",
  },
  {
    id: "skills",
    label: "技能",
    icon: Boxes,
    description: "管理用户技能配置、启用状态和工具开关。",
  },
  {
    id: "general",
    label: "通用",
    icon: SlidersHorizontal,
    description: "控制窗口布局、面板默认状态和基础交互。",
  },
  {
    id: "appearance",
    label: "外观",
    icon: Palette,
    description: "管理主题模式、配色、强调色、字体和字号。",
  },
  {
    id: "system",
    label: "主配置",
    icon: SlidersHorizontal,
    description: "管理系统级配置。运行、规划、检索与文件设置位于各自分区。",
  },
  {
    id: "storage",
    label: "文件与界面",
    icon: FolderCog,
    description: "管理上传、产物、预设和界面默认行为。",
  },
  {
    id: "about",
    label: "关于",
    icon: Info,
    description: "查看 Senera 版本、运行环境和诊断信息。",
  },
] as const satisfies readonly SettingsSectionDefinition[];

export const settingsSectionIds = settingsSections.map((section) => section.id) as readonly SettingsSectionId[];
export const defaultSettingsSectionId: SettingsSectionId = settingsSections[0].id;

export function isSettingsSectionId(value: string | null | undefined): value is SettingsSectionId {
  return settingsSectionIds.includes(value as SettingsSectionId);
}

export function readSettingsSection(sectionId: SettingsSectionId): SettingsSectionDefinition {
  return settingsSections.find((section) => section.id === sectionId) ?? settingsSections[0];
}
