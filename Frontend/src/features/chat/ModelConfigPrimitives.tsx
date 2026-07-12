import type { ReactNode } from "react";
import { AlertTriangle, Check, ChevronDown, Loader2, RefreshCw, Search } from "lucide-react";
import type { ProviderModelsFailedData, ProviderModelsSnapshotData } from "../../api/eventTypes";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { cn } from "../../lib/util";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, Tooltip } from "../../shared/ui";
import { ModelProviderIcon } from "./ModelProviderIcon";
import { formatShortTime } from "./modelConfigData";

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
    <div className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-ink-200/70 bg-[#efe7da] px-3">
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
  subtitle: string;
  actions: ReactNode;
}): JSX.Element {
  return (
    <div className="mb-3 flex min-w-0 flex-wrap items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-ink-200 bg-paper-100 text-ink-650">
          {icon}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-[14px] font-semibold text-ink-900">{title}</span>
          <span className="mt-0.5 block truncate text-[11.5px] text-ink-500">{subtitle}</span>
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">{actions}</div>
    </div>
  );
}

export function SectionLabel({ icon, title }: { icon: ReactNode; title: string }): JSX.Element {
  return (
    <div className="mb-2 flex items-center gap-2 text-[13px] font-semibold text-ink-900">
      <span className="text-ink-450">{icon}</span>
      {title}
    </div>
  );
}

export function SettingsTable({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div className="overflow-hidden border border-ink-200/70 bg-paper-100 shadow-panel">
      <div className="divide-y divide-ink-200/70">{children}</div>
    </div>
  );
}

export function TextRow({
  icon,
  label,
  value,
  disabled,
  placeholder,
  secret,
  trailing,
  onChange,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  disabled: boolean;
  placeholder?: string;
  secret?: boolean;
  trailing?: ReactNode;
  onChange: (value: string) => void;
}): JSX.Element {
  return (
    <SettingRow icon={icon} label={label}>
      <div className="flex min-w-0 overflow-hidden rounded-md border border-ink-200 bg-paper-50">
        <input
          type={secret ? "password" : "text"}
          value={value}
          placeholder={placeholder}
          disabled={disabled}
          spellCheck={false}
          className={inputClassName}
          onChange={(event) => onChange(event.currentTarget.value)}
        />
        {trailing}
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
  icon: ReactNode;
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
  value,
  min,
  max,
  step,
  disabled,
  placeholder,
  onChange,
}: {
  label: string;
  value?: number;
  min?: number;
  max?: number;
  step?: number;
  disabled: boolean;
  placeholder?: string;
  onChange: (value: number | undefined) => void;
}): JSX.Element {
  return (
    <SettingRow icon={<ChevronDown className="h-3.5 w-3.5 rotate-[-90deg]" />} label={label}>
      <input
        type="number"
        value={value ?? ""}
        min={min}
        max={max}
        step={step}
        placeholder={placeholder}
        disabled={disabled}
        className={cn(inputClassName, "rounded-md border border-ink-200 bg-paper-50")}
        onChange={(event) => {
          const next = event.currentTarget.value;
          onChange(next === "" ? undefined : Number(next));
        }}
      />
    </SettingRow>
  );
}

export function ToggleRow({
  label,
  enabled,
  disabled,
  onChange,
}: {
  label: string;
  enabled?: boolean;
  disabled: boolean;
  onChange: (enabled: boolean) => void;
}): JSX.Element {
  return (
    <SettingRow icon={<ChevronDown className="h-3.5 w-3.5 rotate-[-90deg]" />} label={label}>
      <button
        type="button"
        disabled={disabled}
        className={cn(
          "inline-flex h-8 w-fit items-center gap-2 rounded-md border border-ink-200 bg-paper-50 px-2.5 text-[12px] text-ink-650",
          "transition hover:border-terra-200 disabled:pointer-events-none disabled:opacity-50",
        )}
        onClick={() => onChange(!enabled)}
      >
        <span className={cn("relative h-5 w-9 rounded-full", enabled ? "bg-moss-500" : "bg-ink-300")}>
          <span
            className={cn(
              "absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-paper-50 shadow-sm transition-transform",
              enabled && "translate-x-4",
            )}
          />
        </span>
        {enabled ? "ON" : "OFF"}
      </button>
    </SettingRow>
  );
}

export function SettingRow({
  icon,
  label,
  description,
  children,
}: {
  icon: ReactNode;
  label: string;
  description?: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <div className="grid min-w-0 gap-3 bg-paper-50 px-3 py-3 sm:grid-cols-[150px_minmax(0,1fr)] sm:items-start">
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-1.5 text-[12.5px] font-medium text-ink-800">
          <span className="text-ink-400">{icon}</span>
          <span className="truncate">{label}</span>
        </div>
        {description ? <div className="mt-1 text-[11px] leading-4 text-ink-450">{description}</div> : null}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function MenuSelect({
  value,
  placeholder,
  options,
  disabled,
  renderValue,
  renderOption,
  onChange,
}: {
  value: string;
  placeholder: string;
  options: Array<{ value: string; label: string }>;
  disabled: boolean;
  renderValue?: (value: string) => ReactNode;
  renderOption?: (option: { value: string; label: string }) => ReactNode;
  onChange: (value: string) => void;
}): JSX.Element {
  const selected = options.find((option) => option.value === value);
  const display = value && renderValue ? renderValue(value) : selected?.label;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={cn(
            "flex h-8 w-full min-w-0 items-center justify-between gap-2 rounded-md border border-ink-200 bg-paper-50 px-2.5",
            "text-left text-[12.5px] text-ink-800 transition hover:border-terra-200 disabled:pointer-events-none disabled:opacity-55",
          )}
        >
          <span className={cn("min-w-0 truncate", !display && "text-ink-350")}>{display ?? placeholder}</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-ink-350" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-[320px] min-w-[240px] overflow-y-auto bg-paper-50">
        {options.map((option) => (
          <DropdownMenuItem key={option.value} onSelect={() => onChange(option.value)}>
            {renderOption ? renderOption(option) : option.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function SearchInput({
  value,
  disabled,
  onChange,
}: {
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}): JSX.Element {
  return (
    <div className="flex h-8 min-w-0 items-center gap-2 rounded-md border border-ink-200 bg-paper-50 px-2.5">
      <Search className="h-3.5 w-3.5 shrink-0 text-ink-350" />
      <input
        value={value}
        disabled={disabled}
        placeholder={frontendMessage("config.model.searchPlaceholder")}
        className="min-w-0 flex-1 bg-transparent text-[12.5px] text-ink-800 outline-none placeholder:text-ink-350 disabled:opacity-55"
        onChange={(event) => onChange(event.currentTarget.value)}
      />
    </div>
  );
}

export function ProviderStatusIcon({
  loading,
  catalog,
  error,
}: {
  loading?: boolean;
  catalog?: ProviderModelsSnapshotData;
  error?: ProviderModelsFailedData;
}): JSX.Element {
  if (loading) {
    return <Loader2 className="h-3.5 w-3.5 animate-spin text-ink-450" />;
  }
  if (error) {
    return <AlertTriangle className="h-3.5 w-3.5 text-brick-600" />;
  }
  if (catalog) {
    return <Check className="h-3.5 w-3.5 text-moss-600" />;
  }
  return <RefreshCw className="h-3.5 w-3.5 text-ink-350" />;
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
    <AlertTriangle className="h-3.5 w-3.5" />
  ) : loading ? (
    <Loader2 className="h-3.5 w-3.5 animate-spin" />
  ) : error ? (
    <AlertTriangle className="h-3.5 w-3.5" />
  ) : catalog ? (
    <Check className="h-3.5 w-3.5" />
  ) : (
    <RefreshCw className="h-3.5 w-3.5" />
  );
  const text = disabled
    ? frontendMessage("config.provider.disabled")
    : (error?.message ??
      (catalog
        ? frontendMessage("config.provider.catalogStatus", {
            count: catalog.models.length,
            source: frontendMessage(
              catalog.source === "cache" ? "config.provider.sourceCache" : "config.provider.sourceNetwork",
            ),
            time: formatShortTime(catalog.fetchedAt),
          })
        : frontendMessage("config.provider.catalogUnchecked")));

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
        <span className="block truncate">{text}</span>
        {expanded && catalog ? <span className="mt-1 block text-[11px] opacity-75">{catalog.baseUrl}</span> : null}
      </span>
    </div>
  );
}

export function IconAction({
  children,
  label,
  danger,
  disabled,
  onClick,
}: {
  children: ReactNode;
  label: string;
  danger?: boolean;
  disabled: boolean;
  onClick: () => void;
}): JSX.Element {
  return (
    <Tooltip content={label} side="top">
      <button
        type="button"
        disabled={disabled}
        className={cn(iconButtonClassName, danger && "hover:border-brick-200 hover:bg-brick-50 hover:text-brick-600")}
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
    <div className="grid h-full min-h-0 place-items-center px-6 text-center">
      <div>
        <div className="mx-auto grid h-11 w-11 place-items-center rounded-lg bg-ink-900/[0.045] text-ink-450">
          {icon}
        </div>
        <div className="mt-3 text-[13px] font-semibold text-ink-850">{title}</div>
        <div className="mt-1 text-[12px] text-ink-500">{text}</div>
      </div>
    </div>
  );
}

export function EmptyList({ text }: { text: string }): JSX.Element {
  return <div className="grid min-h-40 place-items-center px-5 text-center text-[12px] text-ink-400">{text}</div>;
}

export const iconButtonClassName = cn(
  "grid h-8 w-8 shrink-0 place-items-center rounded-md border border-ink-200 bg-paper-50 text-ink-550",
  "transition hover:border-terra-200 hover:bg-terra-50 hover:text-terra-700",
  "disabled:pointer-events-none disabled:opacity-45",
);

export const inputClassName = cn(
  "h-8 min-w-0 flex-1 bg-transparent px-2.5 text-[12.5px] text-ink-800",
  "outline-none placeholder:text-ink-350 disabled:pointer-events-none disabled:opacity-55",
);

const statusToneClassName = {
  neutral: "bg-ink-900/[0.04] text-ink-550",
  info: "bg-sky-50 text-sky-700",
  success: "bg-moss-50 text-moss-700",
  error: "bg-brick-50 text-brick-700",
};

export function IconOption({ value, label, size = 16 }: { value: string; label: string; size?: number }): JSX.Element {
  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      <ModelProviderIcon icon={value} size={size} />
      <span className="truncate">{label}</span>
    </span>
  );
}
