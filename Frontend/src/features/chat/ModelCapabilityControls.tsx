import type { ReactNode } from "react";
import { cn } from "../../lib/util";
import { AppIcon, type AppIconName, MenuSelect, SwitchTrack, Tooltip } from "../../shared/ui";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import type { ModelsDevModelMetadata } from "../../api/eventTypes";
import { ModelsDevMetadataDetails } from "./ModelConfigPrimitives";
import { ModelsDevCapabilityItemByKey } from "./ModelsDevCapabilityIcons";
import { ModelsDevExtraCapabilityKeys, readModelsDevCapabilityKeys } from "./modelsDevCapabilities";
import type {
  ModelBooleanCapabilityKey,
  ModelToolPlanningMode,
  ResolvedModelCapabilitiesDraft,
} from "./modelConfigTypes";

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
    },
    {
      value: "baml",
      label: frontendMessage("config.model.toolPlanning.baml"),
    },
  ] as const;

  return (
    <MenuSelect
      value={value}
      options={options}
      ariaLabel={label}
      placeholder={label}
      disabled={disabled}
      onChange={(next) => {
        const option = options.find((item) => item.value === next);
        if (option) onChange(option.value);
      }}
    />
  );
}

/** Keep the compact list readable without expanding every capability into a full sentence. */
const VisibleCapabilityIconCount = 3;
const VisibleCapabilityLabelCount = 4;

/**
 * One capabilities chip per row: resolved capability flags plus the models.dev
 * facts the flags do not cover, deduplicated so a model never shows the same
 * capability twice.
 */
export function CapabilityIconStrip({
  capabilities,
  metadata,
  labels = false,
}: {
  capabilities: ResolvedModelCapabilitiesDraft;
  metadata?: ModelsDevModelMetadata;
  labels?: boolean;
}): JSX.Element {
  const items = [
    ...ModelCapabilityIconItems.filter((item) => capabilities[item.key] && (!labels || item.key !== "StreamingUsage")),
    ...readModelsDevCapabilityKeys(metadata)
      .filter((key) => ModelsDevExtraCapabilityKeys[key])
      .map((key) => ({ key, ...ModelsDevCapabilityItemByKey[key] })),
  ];
  if (items.length === 0) {
    return <span className="text-[10px] text-ink-500">{frontendMessage("config.model.noCapabilities")}</span>;
  }
  const visibleItems = items.slice(0, labels ? VisibleCapabilityLabelCount : VisibleCapabilityIconCount);
  const remainingItems = items.slice(visibleItems.length);
  const summary = items.map((item) => item.label).join(" · ");

  const summaryContent = (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 text-content-secondary",
        labels ? "flex-wrap gap-1" : "h-5 rounded-sm bg-ink-900/[0.045] px-1.5 text-ink-500",
      )}
      data-model-capability-summary
      data-capability-count={items.length}
      role="img"
      aria-label={summary}
    >
      {visibleItems.map((item) =>
        labels ? (
          <span
            key={item.key}
            className="inline-flex h-[18px] max-w-24 items-center truncate rounded-[5px] bg-ink-900/[0.045] px-1.5 text-[10.5px] leading-none text-content-secondary"
          >
            {item.label}
          </span>
        ) : (
          <AppIcon icon={item.icon} key={item.key} className="h-3 w-3" aria-hidden={true} />
        ),
      )}
      {remainingItems.length > 0 ? (
        labels ? (
          <RemainingCapabilityTooltip items={remainingItems} />
        ) : (
          <span className="text-[9px] font-medium leading-none">+{remainingItems.length}</span>
        )
      ) : null}
    </span>
  );

  return labels ? (
    summaryContent
  ) : (
    <Tooltip
      content={
        <div className="max-w-xs space-y-1 text-left text-[11px] leading-4">
          <div className="text-[11.5px] font-medium">{summary}</div>
          <ModelsDevMetadataDetails metadata={metadata} />
        </div>
      }
      side="top"
    >
      {summaryContent}
    </Tooltip>
  );
}

function RemainingCapabilityTooltip({ items }: { items: readonly { key: string; label: string }[] }): JSX.Element {
  return (
    <Tooltip content={items.map((item) => item.label).join(" · ")} side="top" align="start" delayDuration={120}>
      <span
        tabIndex={0}
        data-capability-overflow
        className="inline-flex h-[18px] min-w-[18px] cursor-help items-center justify-center rounded-[5px] bg-ink-900/[0.045] px-1.5 text-[10.5px] leading-none text-content-muted outline-none transition hover:bg-ink-900/[0.075] hover:text-content-secondary focus-visible:ring-2 focus-visible:ring-accent-focus"
        aria-label={items.map((item) => item.label).join("、")}
      >
        +{items.length}
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
        "flex min-w-0 items-center justify-between gap-3 rounded-md py-2.5 text-left transition hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus",
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
        <span className={cn("grid h-4 w-4 shrink-0 place-items-center", iconClassName)}>{icon}</span>
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
    icon: "message",
    className: "text-ink-500",
  },
  {
    key: "Vision",
    label: frontendMessage("config.model.capability.vision"),
    icon: "vision",
    className: "text-ink-500",
  },
  {
    key: "ImageOutput",
    label: frontendMessage("config.model.capability.imageOutput"),
    icon: "image-output",
    className: "text-ink-500",
  },
  {
    key: "Reasoning",
    label: frontendMessage("config.model.capability.reasoning"),
    icon: "thinking",
    className: "text-ink-500",
  },
  {
    key: "ToolCalling",
    label: frontendMessage("config.model.capability.toolCalling"),
    icon: "tools",
    className: "text-ink-500",
  },
  {
    key: "DeveloperRole",
    label: frontendMessage("config.model.capability.developerRole"),
    icon: "terminal",
    className: "text-ink-500",
  },
  {
    key: "StreamingUsage",
    label: frontendMessage("config.model.capability.streamingUsage"),
    icon: "token-usage",
    className: "text-ink-500",
  },
] as const satisfies readonly {
  key: ModelBooleanCapabilityKey;
  label: string;
  icon: AppIconName;
  className: string;
}[];
