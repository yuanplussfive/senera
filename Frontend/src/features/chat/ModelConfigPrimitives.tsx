import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import type { ReactNode } from "react";
import type {
  ModelsDevModelMetadata,
  ProviderModelsFailedData,
  ProviderModelsSnapshotData,
} from "../../api/eventTypes";
import { cn, formatShortTime } from "../../lib/util";
import { AppIcon, DurationInput, Spinner, StateView, Switch, Tooltip } from "../../shared/ui";
import { ModelsDevCapabilityStrip } from "./ModelsDevCapabilityIcons";
import { readModelsDevCapabilityKeys } from "./modelsDevCapabilities";
import { ModelProviderIcon } from "../../shared/models/ModelProviderIcon";

export function ListHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle: string;
  action?: ReactNode;
}): JSX.Element {
  return (
    <div className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-ink-200/70 bg-[var(--theme-config-header-bg)] px-3">
      <div className="min-w-0">
        <div className="truncate text-[13px] font-semibold text-ink-900">{title}</div>
        <div className="mt-0.5 truncate text-[11px] text-ink-500">{subtitle}</div>
      </div>
      {action}
    </div>
  );
}

export function DetailTitle({
  icon,
  title,
  subtitle,
  actions,
}: {
  icon: ReactNode;
  title: string;
  subtitle?: string;
  actions: ReactNode;
}): JSX.Element {
  return (
    <div className="mb-4 flex min-w-0 items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="grid h-7 w-7 shrink-0 place-items-center text-ink-650">{icon}</span>
        <span className="min-w-0">
          <span className="block truncate text-[13.5px] font-semibold leading-5 text-ink-900">{title}</span>
          {subtitle ? <span className="block truncate text-[11px] leading-4 text-ink-500">{subtitle}</span> : null}
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-1">{actions}</div>
    </div>
  );
}

export function SectionLabel({
  icon,
  title,
  description,
}: {
  icon: ReactNode;
  title: string;
  description?: string;
}): JSX.Element {
  return (
    <div className="mb-2">
      <div className="flex items-center gap-2 text-[13px] font-semibold text-ink-900">
        <span className="grid h-4 w-4 shrink-0 place-items-center text-content-muted">{icon}</span>
        {title}
      </div>
      {description ? <p className="mt-1 pl-6 text-[11.5px] leading-4 text-ink-500">{description}</p> : null}
    </div>
  );
}

export function SettingsTable({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div className="min-w-0">
      <div className="divide-y divide-line-subtle">{children}</div>
    </div>
  );
}

export function TextRow({
  icon,
  label,
  description,
  value,
  disabled,
  placeholder,
  onChange,
}: {
  icon?: ReactNode;
  label: string;
  description?: string;
  value: string;
  disabled: boolean;
  placeholder?: string;
  onChange?: (value: string) => void;
}): JSX.Element {
  return (
    <SettingRow icon={icon} label={label} description={description}>
      <div className="flex w-full min-w-0 overflow-hidden rounded-md border border-ink-200 bg-paper-50">
        <input
          type="text"
          value={value}
          placeholder={placeholder}
          disabled={disabled}
          spellCheck={false}
          className={inputClassName}
          onChange={(event) => onChange?.(event.currentTarget.value)}
        />
      </div>
    </SettingRow>
  );
}

export function MenuRow({
  icon,
  label,
  description,
  children,
}: {
  icon?: ReactNode;
  label: string;
  description?: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <SettingRow icon={icon} label={label} description={description}>
      {children}
    </SettingRow>
  );
}

export function NumberRow({
  label,
  description,
  value,
  min,
  max,
  step,
  disabled,
  placeholder,
  durationUnit,
  onChange,
}: {
  label: string;
  description?: string;
  value?: number;
  min?: number;
  max?: number;
  step?: number;
  disabled: boolean;
  placeholder?: string;
  durationUnit?: import("../../../../Source/AgentSystem/Types/AgentDurationUnits").AgentDurationUnit;
  onChange: (value: number | undefined) => void;
}): JSX.Element {
  return (
    <SettingRow label={label} description={description}>
      {durationUnit ? (
        <DurationInput
          value={value}
          storageUnit={durationUnit}
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          ariaLabel={label}
          onChange={onChange}
        />
      ) : (
        <input
          type="number"
          aria-label={label}
          value={value ?? ""}
          min={min}
          max={max}
          step={step}
          placeholder={placeholder}
          disabled={disabled}
          className={cn(inputClassName, "w-full rounded-md border border-ink-200 bg-paper-50")}
          onChange={(event) => {
            const next = event.currentTarget.value;
            onChange(next === "" ? undefined : Number(next));
          }}
          onBlur={() => {
            // HTML min/max do not constrain typed values; normalize on blur so the
            // draft the save queue submits stays inside the backend schema bounds.
            if (value === undefined || !Number.isFinite(value)) {
              if (value !== undefined) onChange(undefined);
              return;
            }
            let next = step === 1 ? Math.round(value) : value;
            if (min !== undefined && next < min) next = min;
            if (max !== undefined && next > max) next = max;
            if (next !== value) onChange(next);
          }}
        />
      )}
    </SettingRow>
  );
}

export function ToggleRow({
  label,
  description,
  enabled,
  disabled,
  onChange,
}: {
  label: string;
  description?: string;
  enabled?: boolean;
  disabled: boolean;
  onChange: (enabled: boolean) => void;
}): JSX.Element {
  return (
    <SettingRow label={label} description={description}>
      <Switch
        checked={Boolean(enabled)}
        disabled={disabled}
        ariaLabel={label}
        className="h-8 w-10 justify-center"
        onCheckedChange={onChange}
      />
    </SettingRow>
  );
}
export function SettingRow({
  icon,
  label,
  description,
  children,
}: {
  icon?: ReactNode;
  label: string;
  description?: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <div
      className="grid min-w-0 gap-x-6 gap-y-2 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,280px)] sm:items-start"
      data-model-setting-row
    >
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-1.5 text-[12.5px] font-medium text-ink-800">
          {icon ? <span className="text-ink-400">{icon}</span> : null}
          <span>{label}</span>
        </div>
        {description ? (
          <div className={cn("mt-1 text-[11px] leading-4 text-ink-500", icon && "pl-6")}>{description}</div>
        ) : null}
      </div>
      <div className="flex w-full min-w-0 items-center justify-end">{children}</div>
    </div>
  );
}

export function SearchInput({
  value,
  disabled,
  placeholder,
  className,
  autoFocus = false,
  onChange,
}: {
  value: string;
  disabled: boolean;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
  onChange: (value: string) => void;
}): JSX.Element {
  const resolvedPlaceholder = placeholder ?? frontendMessage("config.model.searchPlaceholder");
  return (
    <div
      className={cn(
        "flex h-8 min-w-0 items-center gap-2 rounded-md border border-line bg-surface-panel px-2.5 transition-[border-color,box-shadow]",
        className,
      )}
    >
      <AppIcon icon="search" className="h-3.5 w-3.5 shrink-0 text-ink-350" />
      <input
        value={value}
        disabled={disabled}
        autoFocus={autoFocus}
        placeholder={resolvedPlaceholder}
        aria-label={resolvedPlaceholder}
        className="min-w-0 flex-1 bg-transparent text-[12px] text-content-primary outline-none placeholder:text-content-muted disabled:opacity-55"
        onChange={(event) => onChange(event.currentTarget.value)}
      />
    </div>
  );
}

export function ProviderCatalogStatus({
  catalog,
  error,
  loading,
  expanded,
  disabled,
}: {
  catalog?: ProviderModelsSnapshotData;
  error?: ProviderModelsFailedData & { updatedAt?: string };
  loading?: boolean;
  expanded?: boolean;
  disabled?: boolean;
}): JSX.Element {
  const tone = disabled ? "neutral" : error ? "error" : catalog ? "success" : loading ? "info" : "neutral";
  const icon = disabled ? (
    <AppIcon icon="warning" className="h-3.5 w-3.5" />
  ) : loading ? (
    <Spinner size="sm" />
  ) : error ? (
    <AppIcon icon="warning" className="h-3.5 w-3.5" />
  ) : catalog ? (
    <AppIcon icon="checkmark" className="h-3.5 w-3.5" />
  ) : (
    <AppIcon icon="refresh" size={14} aria-hidden="true" />
  );
  const text = disabled
    ? frontendMessage("config.model.statusProviderDisabled")
    : loading
      ? frontendMessage("config.model.statusLoading")
      : (error?.message ??
        (catalog
          ? frontendMessage("config.model.statusSummary", {
              count: catalog.models.length,
              source: frontendMessage(
                catalog.source === "cache" ? "config.model.sourceCache" : "config.model.sourceNetwork",
              ),
              time: formatShortTime(catalog.fetchedAt),
            })
          : frontendMessage("config.model.statusNotFetched")));

  return (
    <div
      className={cn(
        "flex min-w-0 items-start gap-2 rounded-md px-2 py-1.5 text-[12px]",
        statusToneClassName[tone],
        expanded && "rounded-lg px-3 py-2.5",
      )}
    >
      <span className="mt-0.5 shrink-0">{icon}</span>
      <span className="min-w-0">
        <span className={cn("block", error ? "whitespace-pre-wrap break-words" : "truncate")}>{text}</span>
        {expanded && catalog ? <span className="mt-1 block text-[11px] opacity-75">{catalog.baseUrl}</span> : null}
      </span>
    </div>
  );
}

export function ModelsDevMetadataSummary({ metadata }: { metadata?: ModelsDevModelMetadata }): JSX.Element | null {
  if (!metadata || readModelsDevCapabilityKeys(metadata).length === 0) {
    return null;
  }
  return (
    <Tooltip
      content={
        <div className="max-w-xs space-y-1 text-left text-[11px] leading-4">
          <ModelsDevMetadataDetails metadata={metadata} />
        </div>
      }
      side="top"
    >
      <span className="inline-flex min-w-0 items-center" data-models-dev-metadata>
        <ModelsDevCapabilityStrip metadata={metadata} />
      </span>
    </Tooltip>
  );
}

/**
 * models.dev model facts as tooltip lines. Colors stay inherited so the lines
 * remain legible on the tooltip surface.
 */
export function ModelsDevMetadataDetails({ metadata }: { metadata?: ModelsDevModelMetadata }): JSX.Element | null {
  if (!metadata) return null;
  const details = [
    metadata.name,
    metadata.description,
    metadata.contextLimit
      ? `${frontendMessage("config.model.catalog.context")}: ${formatCatalogTokens(metadata.contextLimit)}`
      : null,
    metadata.inputLimit
      ? `${frontendMessage("config.model.catalog.input")}: ${formatCatalogTokens(metadata.inputLimit)}`
      : null,
    metadata.outputLimit
      ? `${frontendMessage("config.model.catalog.output")}: ${formatCatalogTokens(metadata.outputLimit)}`
      : null,
    metadata.inputModalities.length > 0
      ? `${frontendMessage("config.model.catalog.modalities")}: ${metadata.inputModalities.join(", ")}`
      : null,
    metadata.toolCall ? frontendMessage("config.model.catalog.tools") : null,
    metadata.reasoning ? frontendMessage("config.model.catalog.reasoning") : null,
    metadata.structuredOutput ? frontendMessage("config.model.catalog.structured") : null,
    metadata.attachment ? frontendMessage("config.model.catalog.attachments") : null,
    metadata.license ? `${frontendMessage("config.model.catalog.license")}: ${metadata.license}` : null,
    metadata.lastUpdated ? `${frontendMessage("config.model.catalog.updated")}: ${metadata.lastUpdated}` : null,
  ].filter((value): value is string => Boolean(value));
  if (details.length === 0) {
    return null;
  }
  return (
    <>
      {details.map((detail, index) => (
        <div
          key={`${detail}-${index}`}
          className={index === 0 ? "font-semibold" : index === 1 && metadata.description ? "opacity-70" : undefined}
        >
          {detail}
        </div>
      ))}
    </>
  );
}

function formatCatalogTokens(value: number): string {
  if (value >= 1_000_000) return `${trimCatalogNumber(value / 1_000_000)}M`;
  if (value >= 1_000) return `${trimCatalogNumber(value / 1_000)}K`;
  return String(value);
}

function trimCatalogNumber(value: number): string {
  return value.toFixed(value >= 100 ? 0 : 1).replace(/\.0$/, "");
}

export function IconAction({
  children,
  label,
  danger,
  disabled,
  onClick,
  className,
}: {
  children: ReactNode;
  label: string;
  danger?: boolean;
  disabled: boolean;
  onClick: () => void;
  className?: string;
}): JSX.Element {
  return (
    <Tooltip content={label} side="top">
      <button
        type="button"
        disabled={disabled}
        className={cn(
          className ?? iconButtonClassName,
          danger && "hover:border-brick-200 hover:bg-brick-50 hover:text-brick-600",
        )}
        aria-label={label}
        onClick={onClick}
      >
        {children}
      </button>
    </Tooltip>
  );
}

export function EmptyDetail({ icon, title, text }: { icon: ReactNode; title: string; text: string }): JSX.Element {
  return (
    <StateView
      status="empty"
      icon={<span className="text-content-muted">{icon}</span>}
      title={title}
      description={text}
    />
  );
}

export function EmptyList({ text }: { text: string }): JSX.Element {
  return <StateView status="empty" description={text} className="min-h-40 px-5" />;
}

export const iconButtonClassName = cn(
  "grid h-8 w-8 shrink-0 place-items-center rounded-md border border-line bg-surface-panel text-content-secondary",
  "transition hover:border-accent-border-strong hover:bg-accent-surface-hover hover:text-accent-content-hover",
  "disabled:pointer-events-none disabled:opacity-45",
);

export const inputClassName = cn(
  "h-8 min-w-0 flex-1 bg-transparent px-2.5 text-[12px] text-content-primary",
  "outline-none placeholder:text-content-muted disabled:pointer-events-none disabled:opacity-55",
);

const statusToneClassName = {
  neutral: "bg-ink-900/[0.04] text-ink-600",
  info: "bg-ink-900/[0.04] text-ink-600",
  success: "bg-moss-50 text-moss-600",
  error: "bg-brick-50 text-brick-700",
};

export function IconOption({ value, label, size = 16 }: { value: string; label: string; size?: number }): JSX.Element {
  return (
    <span className="inline-flex min-w-0 items-center gap-2 leading-5">
      <span className="grid h-5 w-5 shrink-0 place-items-center leading-none">
        <ModelProviderIcon icon={value} size={size} className="block object-contain" />
      </span>
      <span className="truncate">{label}</span>
    </span>
  );
}
