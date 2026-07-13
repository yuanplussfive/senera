import {
  Bot,
  Boxes,
  Brain,
  ChartNoAxesColumn,
  FolderCog,
  Gauge,
  Hammer,
  Info,
  Link2,
  MonitorCog,
  Palette,
  Route,
  Search,
  SlidersHorizontal,
  type LucideIcon,
} from "lucide-react";

export type SettingsSectionId =
  | "model-service"
  | "default-model"
  | "system"
  | "runtime"
  | "planning"
  | "retrieval"
  | "storage"
  | "general"
  | "appearance"
  | "tools"
  | "skills"
  | "memory"
  | "integrations"
  | "usage"
  | "about";

export const settingsSectionIds = [
  "model-service",
  "default-model",
  "system",
  "runtime",
  "planning",
  "retrieval",
  "storage",
  "general",
  "appearance",
  "tools",
  "skills",
  "memory",
  "integrations",
  "usage",
  "about",
] as const satisfies readonly SettingsSectionId[];

export const defaultSettingsSectionId = settingsSectionIds[0];

export function isSettingsSectionId(value: string | null | undefined): value is SettingsSectionId {
  return settingsSectionIds.includes(value as SettingsSectionId);
}

export interface SettingsSectionDefinition {
  id: SettingsSectionId;
  label: string;
  icon: LucideIcon;
  enabled: boolean;
  description: string;
}

export const settingsSections = [
  {
    id: "model-service",
    label: "模型服务",
    icon: Bot,
    enabled: true,
    description: "管理供应商连接、模型列表和模型参数。",
  },
  {
    id: "default-model",
    label: "默认模型",
    icon: Bot,
    enabled: true,
    description: "选择当前运行时使用的默认助手模型。",
  },
  {
    id: "system",
    label: "主配置",
    icon: SlidersHorizontal,
    enabled: true,
    description: "管理系统级配置；运行、规划、检索与存储分别在各自分区。",
  },
  {
    id: "runtime",
    label: "运行",
    icon: Gauge,
    enabled: true,
    description: "管理主循环、工具执行、服务和持久化。",
  },
  {
    id: "planning",
    label: "规划与学习",
    icon: Route,
    enabled: true,
    description: "管理 Planner、工具学习和长期记忆晋升。",
  },
  {
    id: "retrieval",
    label: "检索与向量",
    icon: Search,
    enabled: true,
    description: "管理工具检索、向量模型和重排序。",
  },
  {
    id: "storage",
    label: "文件与界面",
    icon: FolderCog,
    enabled: true,
    description: "管理上传、产物、预设和前端默认显示。",
  },
  {
    id: "general",
    label: "通用",
    icon: SlidersHorizontal,
    enabled: true,
    description: "控制窗口布局、面板默认状态和基础交互。",
  },
  {
    id: "appearance",
    label: "外观",
    icon: Palette,
    enabled: true,
    description: "管理主题模式、配色、强调色、字体和字号。",
  },
  {
    id: "tools",
    label: "工具",
    icon: Hammer,
    enabled: false,
    description: "工具开关、权限和插件配置会逐步集中到设置工作台。",
  },
  {
    id: "skills",
    label: "技能",
    icon: Boxes,
    enabled: true,
    description: "管理用户技能配置、启用状态和工具开关。",
  },
  {
    id: "memory",
    label: "记忆",
    icon: Brain,
    enabled: false,
    description: "记忆策略、召回和学习配置会迁入这个分区。",
  },
  {
    id: "integrations",
    label: "集成",
    icon: Link2,
    enabled: false,
    description: "外部服务、搜索和运行环境配置会在这里扩展。",
  },
  {
    id: "usage",
    label: "用量",
    icon: ChartNoAxesColumn,
    enabled: false,
    description: "调用、token 和运行统计会在这里汇总。",
  },
  {
    id: "about",
    label: "关于",
    icon: Info,
    enabled: true,
    description: "查看版本、运行表面和桌面验证线索。",
  },
] as const satisfies readonly SettingsSectionDefinition[];

export const settingsShellIcon = MonitorCog;
