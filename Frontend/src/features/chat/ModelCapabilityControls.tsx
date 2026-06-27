import type { ReactNode } from "react";
import {
  ArrowUpDown,
  BrainCircuit,
  Database,
  Eye,
  ImageIcon,
  MessageCircle,
  Wrench,
} from "lucide-react";
import { cn } from "../../lib/util";
import type { ModelCapabilitiesDraft } from "./modelConfigTypes";

export function CapabilityIconStrip({
  capabilities,
}: {
  capabilities: Required<ModelCapabilitiesDraft>;
}): JSX.Element {
  const enabledItems = ModelCapabilityIconItems.filter((item) => capabilities[item.key]);
  if (enabledItems.length === 0) {
    return (
      <span className="rounded-full border border-ink-200 bg-ink-900/[0.035] px-1.5 py-0.5 text-[10px] text-ink-400">
        无能力
      </span>
    );
  }
  return (
    <span className="flex min-w-0 items-center gap-1">
      {enabledItems.map((item) => (
        <span
          key={item.key}
          className={cn(
            "grid h-5 min-w-5 place-items-center rounded-full border px-1 text-[10px]",
            item.className,
          )}
          title={item.label}
          aria-label={item.label}
        >
          {item.icon}
        </span>
      ))}
    </span>
  );
}

export function CapabilityToggle({
  label,
  icon,
  iconClassName,
  enabled,
  disabled,
  onChange,
}: {
  label: string;
  icon: ReactNode;
  iconClassName: string;
  enabled?: boolean;
  disabled: boolean;
  onChange: (enabled: boolean) => void;
}): JSX.Element {
  const active = Boolean(enabled);
  return (
    <button
      type="button"
      disabled={disabled}
      className={cn(
        "grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition",
        active
          ? "border-moss-200 bg-moss-50 text-ink-900"
          : "border-ink-200 bg-paper-100 text-ink-650 hover:bg-ink-900/[0.035]",
        disabled && "pointer-events-none opacity-50",
      )}
      onClick={() => onChange(!active)}
    >
      <span className="flex min-w-0 items-center gap-2">
        <span className={cn("grid h-6 w-6 shrink-0 place-items-center rounded-full border", iconClassName)}>
          {icon}
        </span>
        <span className="truncate text-[12.5px] font-medium">{label}</span>
      </span>
      <span className={cn(
        "relative h-5 w-9 rounded-full transition",
        active ? "bg-moss-500" : "bg-ink-300",
      )}>
        <span className={cn(
          "absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-paper-50 shadow-sm transition-transform",
          active && "translate-x-4",
        )} />
      </span>
      <span className={cn("col-span-2 text-[10.5px] font-semibold", active ? "text-moss-700" : "text-ink-400")}>
        {active ? "ON" : "OFF"}
      </span>
    </button>
  );
}

export const ModelCapabilityIconItems = [
  {
    key: "Chat",
    label: "对话",
    icon: <MessageCircle className="h-3 w-3" />,
    className: "border-lime-200 bg-lime-50 text-lime-700",
  },
  {
    key: "Embedding",
    label: "向量嵌入",
    icon: <Database className="h-3 w-3" />,
    className: "border-sky-200 bg-sky-50 text-sky-700",
  },
  {
    key: "Rerank",
    label: "重排序",
    icon: <ArrowUpDown className="h-3 w-3" />,
    className: "border-indigo-200 bg-indigo-50 text-indigo-700",
  },
  {
    key: "Vision",
    label: "识图",
    icon: <Eye className="h-3 w-3" />,
    className: "border-violet-200 bg-violet-50 text-violet-700",
  },
  {
    key: "ImageOutput",
    label: "图像输出",
    icon: <ImageIcon className="h-3 w-3" />,
    className: "border-fuchsia-200 bg-fuchsia-50 text-fuchsia-700",
  },
  {
    key: "Reasoning",
    label: "推理",
    icon: <BrainCircuit className="h-3 w-3" />,
    className: "border-terra-200 bg-terra-50 text-terra-700",
  },
  {
    key: "ToolCalling",
    label: "工具调用",
    icon: <Wrench className="h-3 w-3" />,
    className: "border-amber-200 bg-amber-50 text-amber-700",
  },
] as const satisfies readonly {
  key: keyof ModelCapabilitiesDraft;
  label: string;
  icon: JSX.Element;
  className: string;
}[];
