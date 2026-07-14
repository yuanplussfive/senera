import type { ReactNode } from "react";
import { ArrowUpDown, BrainCircuit, Database, Eye, ImageIcon, MessageCircle, ShieldCheck } from "lucide-react";
import { cn } from "../../lib/util";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import type { ModelCapabilitiesDraft } from "./modelConfigTypes";

export function CapabilityIconStrip({ capabilities }: { capabilities: Required<ModelCapabilitiesDraft> }): JSX.Element {
  const enabledItems = ModelCapabilityIconItems.filter((item) => capabilities[item.key]);
  if (enabledItems.length === 0) {
    return (
      <span className="text-[10px] text-ink-400">
        {frontendMessage("config.model.noCapabilities")}
      </span>
    );
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
        "grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition",
        active
          ? "border-ink-300 bg-paper-50 text-ink-900"
          : "border-ink-200 bg-paper-100 text-ink-650 hover:bg-ink-900/[0.035]",
        disabled && "pointer-events-none opacity-50",
      )}
      onClick={() => onChange(!active)}
      aria-pressed={active}
    >
      <span className="flex min-w-0 items-center gap-2">
        <span className={cn("grid h-6 w-6 shrink-0 place-items-center", iconClassName)}>
          {icon}
        </span>
        <span className="truncate text-[12.5px] font-medium">{label}</span>
      </span>
      <span className={cn("relative h-5 w-9 rounded-full transition", active ? "bg-moss-500" : "bg-ink-300")}>
        <span
          className={cn(
            "absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-paper-50 shadow-sm transition-transform",
            active && "translate-x-4",
          )}
        />
      </span>
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
    key: "DeveloperRole",
    label: "Developer Role",
    icon: <ShieldCheck className="h-3 w-3" />,
    className: "text-ink-500",
  },
] as const satisfies readonly {
  key: keyof ModelCapabilitiesDraft;
  label: string;
  icon: JSX.Element;
  className: string;
}[];
