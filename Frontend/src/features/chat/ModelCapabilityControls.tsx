import type { ElementType, ReactNode } from "react";
import ArrowsUpDownIcon from "@heroicons/react/24/outline/ArrowsUpDownIcon";
import ChatBubbleLeftRightIcon from "@heroicons/react/24/outline/ChatBubbleLeftRightIcon";
import CircleStackIcon from "@heroicons/react/24/outline/CircleStackIcon";
import CommandLineIcon from "@heroicons/react/24/outline/CommandLineIcon";
import EyeIcon from "@heroicons/react/24/outline/EyeIcon";
import LightBulbIcon from "@heroicons/react/24/outline/LightBulbIcon";
import PhotoIcon from "@heroicons/react/24/outline/PhotoIcon";
import SignalIcon from "@heroicons/react/24/outline/SignalIcon";
import WrenchScrewdriverIcon from "@heroicons/react/24/outline/WrenchScrewdriverIcon";
import { cn } from "../../lib/util";
import { SwitchTrack, Tooltip } from "../../shared/ui";
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
      icon: <WrenchScrewdriverIcon className="h-3.5 w-3.5" />,
    },
    {
      value: "baml",
      label: frontendMessage("config.model.toolPlanning.baml"),
      icon: <LightBulbIcon className="h-3.5 w-3.5" />,
    },
  ] as const;

  return (
    <div
      className="flex items-center gap-1 border-b border-ink-200/80"
      role="radiogroup"
      aria-label={label}
      data-model-tool-planning-mode
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
              "inline-flex h-9 min-w-0 items-center justify-center gap-2 border-b-2 px-3 text-[12.5px] font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus disabled:pointer-events-none disabled:opacity-50",
              selected ? "border-accent-solid text-ink-900" : "border-transparent text-ink-500 hover:text-ink-900",
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
  const visibleItems = enabledItems.slice(0, 3);
  const remainingCount = enabledItems.length - visibleItems.length;
  const summary = enabledItems.map((item) => item.label).join(" · ");

  return (
    <Tooltip content={summary} side="top">
      <span
        className="inline-flex h-5 items-center gap-1 rounded-sm bg-ink-900/[0.045] px-1.5 text-ink-500"
        data-model-capability-summary
        data-capability-count={enabledItems.length}
        role="img"
        aria-label={summary}
      >
        {visibleItems.map((item) => (
          <item.Icon key={item.key} className="h-3 w-3" aria-hidden="true" />
        ))}
        {remainingCount > 0 ? <span className="text-[9px] font-medium leading-none">+{remainingCount}</span> : null}
      </span>
    </Tooltip>
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
        "flex min-w-0 items-center justify-between gap-3 rounded-sm px-2.5 py-2 text-left transition hover:bg-ink-900/[0.035] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus",
        active ? "text-ink-900" : "text-ink-600",
        disabled && "pointer-events-none opacity-50",
      )}
      onClick={() => onChange(!active)}
      role="switch"
      aria-checked={active}
      aria-label={label}
      data-model-capability-toggle
    >
      <span className="flex min-w-0 items-center gap-2">
        <span className={cn("grid h-5 w-5 shrink-0 place-items-center", iconClassName)}>{icon}</span>
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
    Icon: ChatBubbleLeftRightIcon,
    icon: <ChatBubbleLeftRightIcon className="h-3.5 w-3.5" />,
    className: "text-ink-500",
  },
  {
    key: "Embedding",
    label: frontendMessage("config.model.capability.embedding"),
    Icon: CircleStackIcon,
    icon: <CircleStackIcon className="h-3.5 w-3.5" />,
    className: "text-ink-500",
  },
  {
    key: "Rerank",
    label: frontendMessage("config.model.capability.rerank"),
    Icon: ArrowsUpDownIcon,
    icon: <ArrowsUpDownIcon className="h-3.5 w-3.5" />,
    className: "text-ink-500",
  },
  {
    key: "Vision",
    label: frontendMessage("config.model.capability.vision"),
    Icon: EyeIcon,
    icon: <EyeIcon className="h-3.5 w-3.5" />,
    className: "text-ink-500",
  },
  {
    key: "ImageOutput",
    label: frontendMessage("config.model.capability.imageOutput"),
    Icon: PhotoIcon,
    icon: <PhotoIcon className="h-3.5 w-3.5" />,
    className: "text-ink-500",
  },
  {
    key: "Reasoning",
    label: frontendMessage("config.model.capability.reasoning"),
    Icon: LightBulbIcon,
    icon: <LightBulbIcon className="h-3.5 w-3.5" />,
    className: "text-ink-500",
  },
  {
    key: "ToolCalling",
    label: frontendMessage("config.model.capability.toolCalling"),
    Icon: WrenchScrewdriverIcon,
    icon: <WrenchScrewdriverIcon className="h-3.5 w-3.5" />,
    className: "text-ink-500",
  },
  {
    key: "DeveloperRole",
    label: frontendMessage("config.model.capability.developerRole"),
    Icon: CommandLineIcon,
    icon: <CommandLineIcon className="h-3.5 w-3.5" />,
    className: "text-ink-500",
  },
  {
    key: "StreamingUsage",
    label: frontendMessage("config.model.capability.streamingUsage"),
    Icon: SignalIcon,
    icon: <SignalIcon className="h-3.5 w-3.5" />,
    className: "text-ink-500",
  },
] as const satisfies readonly {
  key: keyof ModelCapabilitiesDraft;
  label: string;
  Icon: ElementType<{ className?: string; "aria-hidden"?: boolean }>;
  icon: JSX.Element;
  className: string;
}[];
