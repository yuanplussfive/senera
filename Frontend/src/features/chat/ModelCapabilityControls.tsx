import type { ReactNode } from "react";
import {
  Activity,
  ArrowUpDown,
  BrainCircuit,
  Database,
  Eye,
  ImageIcon,
  MessageCircle,
  Network,
  ShieldCheck,
  Wrench,
} from "lucide-react";
import { cn } from "../../lib/util";
import { SwitchTrack } from "../../shared/ui";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import type { ModelCapabilitiesDraft, ModelToolPlanningMode } from "./modelConfigTypes";

export function ToolPlanningModeControl({
  value,
  disabled,
  onChange,
}: {
  value: ModelToolPlanningMode;
  disabled: boolean;
  onChange: (value: ModelToolPlanningMode) => void;
}): JSX.Element {
  const label = frontendMessage("config.model.toolPlanningTitle");
  const options = [
    {
      value: "native",
      label: frontendMessage("config.model.toolPlanning.native"),
      icon: <Network className="h-3.5 w-3.5" />,
    },
    {
      value: "baml",
      label: frontendMessage("config.model.toolPlanning.baml"),
      icon: <BrainCircuit className="h-3.5 w-3.5" />,
    },
  ] as const;

  return (
    <div
      className="grid grid-cols-2 gap-1 rounded-lg border border-ink-200 bg-paper-100 p-1"
      role="radiogroup"
      aria-label={label}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            className={cn(
              "inline-flex h-9 min-w-0 items-center justify-center gap-2 rounded-md px-3 text-[12.5px] font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus disabled:pointer-events-none disabled:opacity-50",
              selected
                ? "border border-ink-200 bg-paper-50 text-ink-900 shadow-sm"
                : "border border-transparent text-ink-600 hover:bg-ink-900/[0.035] hover:text-ink-900",
            )}
            onClick={() => onChange(option.value)}
          >
            {option.icon}
            <span className="truncate">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export function CapabilityIconStrip({ capabilities }: { capabilities: Required<ModelCapabilitiesDraft> }): JSX.Element {
  const enabledItems = ModelCapabilityIconItems.filter((item) => capabilities[item.key]);
  if (enabledItems.length === 0) {
    return <span className="text-[10px] text-ink-500">{frontendMessage("config.model.noCapabilities")}</span>;
  }
  return (
    <span className="flex min-w-0 items-center gap-1">
      {enabledItems.map((item) => (
        <span
          key={item.key}
          className={cn("grid h-5 w-5 place-items-center text-[10px]", item.className)}
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
        "grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus",
        active
          ? "border-ink-300 bg-paper-50 text-ink-900"
          : "border-ink-200 bg-paper-100 text-ink-650 hover:bg-ink-900/[0.035]",
        disabled && "pointer-events-none opacity-50",
      )}
      onClick={() => onChange(!active)}
      aria-pressed={active}
    >
      <span className="flex min-w-0 items-center gap-2">
        <span className={cn("grid h-6 w-6 shrink-0 place-items-center", iconClassName)}>{icon}</span>
        <span className="truncate text-[12.5px] font-medium">{label}</span>
      </span>
      <SwitchTrack checked={active} />
    </button>
  );
}

export const ModelCapabilityIconItems = [
  {
    key: "Chat",
    label: frontendMessage("config.model.capability.chat"),
    icon: <MessageCircle className="h-3 w-3" />,
    className: "text-ink-500",
  },
  {
    key: "Embedding",
    label: frontendMessage("config.model.capability.embedding"),
    icon: <Database className="h-3 w-3" />,
    className: "text-ink-500",
  },
  {
    key: "Rerank",
    label: frontendMessage("config.model.capability.rerank"),
    icon: <ArrowUpDown className="h-3 w-3" />,
    className: "text-ink-500",
  },
  {
    key: "Vision",
    label: frontendMessage("config.model.capability.vision"),
    icon: <Eye className="h-3 w-3" />,
    className: "text-ink-500",
  },
  {
    key: "ImageOutput",
    label: frontendMessage("config.model.capability.imageOutput"),
    icon: <ImageIcon className="h-3 w-3" />,
    className: "text-ink-500",
  },
  {
    key: "Reasoning",
    label: frontendMessage("config.model.capability.reasoning"),
    icon: <BrainCircuit className="h-3 w-3" />,
    className: "text-ink-500",
  },
  {
    key: "ToolCalling",
    label: frontendMessage("config.model.capability.toolCalling"),
    icon: <Wrench className="h-3 w-3" />,
    className: "text-ink-500",
  },
  {
    key: "DeveloperRole",
    label: frontendMessage("config.model.capability.developerRole"),
    icon: <ShieldCheck className="h-3 w-3" />,
    className: "text-ink-500",
  },
  {
    key: "StreamingUsage",
    label: frontendMessage("config.model.capability.streamingUsage"),
    icon: <Activity className="h-3 w-3" />,
    className: "text-umber-600",
  },
] as const satisfies readonly {
  key: keyof ModelCapabilitiesDraft;
  label: string;
  icon: JSX.Element;
  className: string;
}[];
