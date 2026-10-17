import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { AgentRuntimeDependencySnapshot } from "../../../api/eventTypes";
import { formatFrontendList, frontendMessage, type FrontendMessageKey } from "../../../i18n/frontendMessageCatalog";
import { resolveFrontendLocalizedText, type FrontendLocale } from "../../../i18n/frontendLocaleModel";
import { useFrontendLocale } from "../../../i18n/useFrontendLocale";
import { cn } from "../../../lib/util";
import {
  AppIcon,
  Button,
  IconButton,
  MetaLabel,
  ScrollArea,
  Spinner,
  StateView,
  useClipboardCopy,
} from "../../../shared/ui";
import type { SettingsSystemConfigHandle } from "../SettingsContracts";

const statusMessageKeys: Record<AgentRuntimeDependencySnapshot["status"], FrontendMessageKey> = {
  checking: "settings.dependencies.status.checking",
  installing: "settings.dependencies.status.installing",
  ready: "settings.dependencies.status.ready",
  unavailable: "settings.dependencies.status.unavailable",
  failed: "settings.dependencies.status.failed",
};

const phaseMessageKeys: Record<string, FrontendMessageKey> = {
  downloading: "settings.dependencies.phase.downloading",
  extracting: "settings.dependencies.phase.extracting",
  "health-check": "settings.dependencies.phase.health-check",
  ready: "settings.dependencies.phase.ready",
  failed: "settings.dependencies.phase.failed",
};

const kindMessageKeys: Record<AgentRuntimeDependencySnapshot["kind"], FrontendMessageKey> = {
  controller: "settings.dependencies.kind.controller",
  browser: "settings.dependencies.kind.browser",
};

export function RuntimeDependenciesSection({
  systemConfig,
}: {
  systemConfig?: SettingsSystemConfigHandle;
}): JSX.Element {
  const locale = useFrontendLocale();
  const dependencies = useMemo(
    () => [...(systemConfig?.runtimeDependencies ?? [])].sort((left, right) => left.id.localeCompare(right.id)),
    [systemConfig?.runtimeDependencies],
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const connected = systemConfig?.socketStatus === "open";
  const selected = selectedId ? (dependencies.find((dependency) => dependency.id === selectedId) ?? null) : null;

  useEffect(() => {
    if (dependencies.length === 0) {
      setSelectedId(null);
      return;
    }
    if (!selectedId || !dependencies.some((dependency) => dependency.id === selectedId)) {
      setSelectedId(dependencies[0].id);
    }
  }, [dependencies, selectedId]);

  if (!systemConfig || (dependencies.length === 0 && !connected)) {
    return (
      <StateView
        status="loading"
        description={frontendMessage("settings.dependencies.loading")}
        className="h-full min-h-[220px] bg-surface-canvas"
      />
    );
  }

  if (dependencies.length === 0) {
    return (
      <StateView
        status="empty"
        icon={<AppIcon icon="package" size={20} aria-hidden="true" />}
        title={frontendMessage("settings.dependencies.empty")}
        action={
          <Button
            variant="outline"
            size="sm"
            disabled={!connected}
            onClick={() => systemConfig.refreshRuntimeDependencies()}
          >
            <AppIcon icon="refresh" size={14} aria-hidden="true" />
            {frontendMessage("settings.dependencies.refresh")}
          </Button>
        }
        className="h-full min-h-[220px] bg-surface-canvas"
      />
    );
  }

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden bg-surface-canvas" data-runtime-dependencies>
      <header className="mx-auto flex w-full max-w-[1120px] shrink-0 items-center justify-between gap-4 border-b border-line px-6 py-4 lg:px-8">
        <div className="flex min-w-0 items-start gap-3">
          <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-md bg-accent-content/[0.08] text-accent-content">
            <AppIcon icon="package" size={16} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
              <h1 className="text-[14px] font-semibold text-content-primary">
                {frontendMessage("settings.dependencies.title")}
              </h1>
            </div>
            <p className="mt-1 max-w-[700px] text-[11px] leading-4 text-content-muted">
              {frontendMessage("settings.dependencies.directoryDescription")}
            </p>
          </div>
        </div>
        <IconButton
          label={frontendMessage("settings.dependencies.refresh")}
          tooltip={frontendMessage("settings.dependencies.refresh")}
          size="sm"
          tone="muted"
          disabled={!connected}
          onClick={() => systemConfig.refreshRuntimeDependencies()}
        >
          <AppIcon icon="refresh" size={16} aria-hidden="true" />
        </IconButton>
      </header>

      <div className="mx-auto grid min-h-0 w-full max-w-[1120px] flex-1 md:grid-cols-[minmax(220px,300px)_minmax(0,1fr)]">
        <ScrollArea className="min-h-0 border-b border-line md:border-b-0 md:border-r" viewportClassName="h-full">
          <div
            className="px-3 py-3"
            role="listbox"
            aria-label={frontendMessage("settings.dependencies.count", { count: dependencies.length })}
          >
            {dependencies.map((dependency) => (
              <DependencyListItem
                key={dependency.id}
                dependency={dependency}
                locale={locale}
                selected={dependency.id === selected?.id}
                onSelect={() => setSelectedId(dependency.id)}
              />
            ))}
          </div>
        </ScrollArea>

        <ScrollArea className="min-h-0" viewportClassName="h-full">
          {selected ? <DependencyDetail dependency={selected} locale={locale} systemConfig={systemConfig} /> : null}
        </ScrollArea>
      </div>
    </section>
  );
}

function DependencyListItem({
  dependency,
  locale,
  selected,
  onSelect,
}: {
  dependency: AgentRuntimeDependencySnapshot;
  locale: FrontendLocale;
  selected: boolean;
  onSelect: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      onClick={onSelect}
      className={cn(
        "mb-1 flex w-full items-center gap-3 rounded-md px-3 py-3 text-left transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus",
        selected ? "bg-accent-content/[0.07]" : "hover:bg-surface-hover",
      )}
    >
      <span className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-md", statusTone(dependency.status).icon)}>
        <AppIcon icon={dependency.kind === "browser" ? "globe" : "terminal"} size={16} aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12.5px] font-medium text-content-primary">
          {resolveFrontendLocalizedText(dependency.displayName, locale)}
        </span>
        <span className="mt-1 flex min-w-0 items-center gap-1.5 truncate text-[10.5px]">
          <span className="truncate text-content-muted">{frontendMessage(kindMessageKeys[dependency.kind])}</span>
          <span className={cn("truncate", statusTone(dependency.status).text)}>
            {frontendMessage(statusMessageKeys[dependency.status])}
          </span>
        </span>
      </span>
      <span className={cn("h-2 w-2 shrink-0 rounded-full", statusTone(dependency.status).dot)} aria-hidden="true" />
    </button>
  );
}

function DependencyDetail({
  dependency,
  locale,
  systemConfig,
}: {
  dependency: AgentRuntimeDependencySnapshot;
  locale: FrontendLocale;
  systemConfig: SettingsSystemConfigHandle;
}): JSX.Element {
  const busy = dependency.status === "installing" || dependency.status === "checking";
  const canInstall = dependency.installable && !busy && systemConfig.socketStatus === "open";
  const percent = dependency.percent === undefined ? null : Math.max(0, Math.min(100, dependency.percent));
  const phase = formatDependencyPhase(dependency.phase);
  const checkedAt = formatDate(dependency.checkedAt, locale);
  const tone = statusTone(dependency.status);
  const path = dependency.path ?? frontendMessage("settings.dependencies.pathManaged");
  const size = dependency.sizeBytes === undefined ? null : formatBytes(dependency.sizeBytes, locale);
  const transferRate =
    dependency.bytesPerSecond === undefined
      ? null
      : frontendMessage("settings.dependencies.transferRate", {
          value: formatBytes(dependency.bytesPerSecond, locale),
        });
  const transferProgress =
    dependency.transferredBytes === undefined || dependency.totalBytes === undefined
      ? null
      : frontendMessage("settings.dependencies.transferProgress", {
          current: formatBytes(dependency.transferredBytes, locale),
          total: formatBytes(dependency.totalBytes, locale),
        });
  const { copied, copyText } = useClipboardCopy({ successMessage: frontendMessage("settings.action.copied") });

  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-7 lg:px-10">
      <div className="flex flex-col gap-5 border-b border-line pb-6 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-4">
          <span className={cn("grid h-11 w-11 shrink-0 place-items-center rounded-lg", tone.icon)}>
            <AppIcon icon={dependency.kind === "browser" ? "globe" : "terminal"} size={23} aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <h2 className="text-[17px] font-semibold tracking-[-0.01em] text-content-primary">
                {resolveFrontendLocalizedText(dependency.displayName, locale)}
              </h2>
              <span className={cn("text-[11px] font-medium", tone.text)}>
                {frontendMessage(statusMessageKeys[dependency.status])}
              </span>
            </div>
            <p className="mt-2 max-w-[650px] text-[12px] leading-5 text-content-secondary">
              {resolveFrontendLocalizedText(dependency.description, locale)}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <IconButton
            label={frontendMessage("settings.dependencies.check")}
            tooltip={frontendMessage("settings.dependencies.check")}
            size="sm"
            tone="muted"
            disabled={busy || systemConfig.socketStatus !== "open"}
            onClick={() => systemConfig.checkRuntimeDependency(dependency.id)}
          >
            <AppIcon icon="refresh" size={15} aria-hidden="true" />
          </IconButton>
          {dependency.installable ? (
            <Button
              size="sm"
              variant={dependency.status === "ready" ? "outline" : "default"}
              loading={busy}
              disabled={!canInstall}
              onClick={() => systemConfig.installRuntimeDependency(dependency.id)}
            >
              <AppIcon icon="download" size={14} aria-hidden="true" />
              {dependency.status === "ready"
                ? frontendMessage("settings.dependencies.reinstall")
                : frontendMessage("settings.dependencies.install")}
            </Button>
          ) : null}
        </div>
      </div>

      {busy || percent !== null ? (
        <div className="mt-6 border-y border-line py-4" aria-live="polite">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-center gap-2.5">
              <span className={cn("grid h-7 w-7 shrink-0 place-items-center rounded-md", tone.icon)}>
                {busy ? <Spinner size="xs" /> : <AppIcon icon="checkmark" size={14} aria-hidden="true" />}
              </span>
              <div className="min-w-0">
                <MetaLabel as="div">{frontendMessage("settings.dependencies.installation")}</MetaLabel>
                <div className={cn("mt-0.5 truncate text-[12px] font-medium", tone.text)}>
                  {phase ?? frontendMessage(statusMessageKeys[dependency.status])}
                </div>
              </div>
            </div>
            {percent !== null ? (
              <span className="tabular-nums text-[12px] font-medium text-content-primary">{Math.round(percent)}%</span>
            ) : null}
          </div>
          {percent !== null ? (
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-ink-200/70">
              <div
                className="h-full rounded-full bg-accent-solid transition-[width] duration-300"
                style={{ width: `${percent}%` }}
              />
            </div>
          ) : null}
          {transferRate || transferProgress ? (
            <p className="mt-2 text-[10.5px] text-content-muted">
              {[transferProgress, transferRate].filter(Boolean).join(" · ")}
            </p>
          ) : null}
        </div>
      ) : null}

      <dl className="mt-7 divide-y divide-line border-y border-line text-[12px]">
        <DependencyDetailRow label={frontendMessage("settings.dependencies.version")}>
          {dependency.version ?? frontendMessage("settings.dependencies.notReported")}
        </DependencyDetailRow>
        <DependencyDetailRow label={frontendMessage("settings.dependencies.size")}>
          {size ?? frontendMessage("settings.dependencies.notReported")}
        </DependencyDetailRow>
        <DependencyDetailRow label={frontendMessage("settings.dependencies.cache")}>
          {dependency.cacheStatus === "available"
            ? frontendMessage("settings.dependencies.cacheAvailable")
            : dependency.cacheStatus === "missing"
              ? frontendMessage("settings.dependencies.cacheMissing")
              : frontendMessage("settings.dependencies.notReported")}
        </DependencyDetailRow>
        <DependencyDetailRow label={frontendMessage("settings.dependencies.checkedAt")}>
          {checkedAt}
        </DependencyDetailRow>
      </dl>

      <section className="mt-7">
        <div className="flex items-center justify-between gap-3">
          <MetaLabel as="h3">{frontendMessage("settings.dependencies.path")}</MetaLabel>
          <IconButton
            label={frontendMessage("settings.dependencies.copyPath")}
            tooltip={
              copied ? frontendMessage("settings.action.copied") : frontendMessage("settings.dependencies.copyPath")
            }
            size="sm"
            tone="muted"
            onClick={() => void copyText(path)}
          >
            <AppIcon icon={copied ? "checkmark" : "copy"} size={14} aria-hidden="true" />
          </IconButton>
        </div>
        <p className="mt-2 max-h-24 overflow-auto break-all font-mono text-[11px] leading-5 text-content-secondary">
          {path}
        </p>
      </section>

      {dependency.cachePath ? (
        <section className="mt-7">
          <MetaLabel as="h3">{frontendMessage("settings.dependencies.cachePath")}</MetaLabel>
          <p className="mt-2 break-all font-mono text-[11px] leading-5 text-content-secondary">
            {dependency.cachePath}
          </p>
        </section>
      ) : null}

      {dependency.capabilities.length > 0 ? (
        <section className="mt-7">
          <MetaLabel as="h3">{frontendMessage("settings.dependencies.capabilities")}</MetaLabel>
          <p className="mt-2 text-[12px] leading-5 text-content-secondary">
            {formatFrontendList(dependency.capabilities, locale)}
          </p>
        </section>
      ) : null}

      {dependency.message ? (
        <section className="mt-7 border-t border-line pt-5">
          <MetaLabel as="h3">{frontendMessage("settings.dependencies.message")}</MetaLabel>
          <p className={cn("mt-2 break-words text-[11px] leading-5", tone.text)}>{dependency.message}</p>
        </section>
      ) : null}
    </div>
  );
}

function DependencyDetailRow({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <div className="grid gap-1.5 px-1 py-3 sm:grid-cols-[140px_minmax(0,1fr)] sm:gap-5">
      <dt className="text-content-muted">{label}</dt>
      <dd className="min-w-0 break-words text-content-primary">{children}</dd>
    </div>
  );
}

function formatDependencyPhase(phase: string | undefined): string | null {
  if (!phase) return null;
  const messageKey = phaseMessageKeys[phase];
  return messageKey ? frontendMessage(messageKey) : phase;
}

function statusTone(status: AgentRuntimeDependencySnapshot["status"]): {
  readonly text: string;
  readonly icon: string;
  readonly dot: string;
} {
  switch (status) {
    case "ready":
      return {
        text: "text-emerald-600 dark:text-emerald-400",
        icon: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
        dot: "bg-emerald-500",
      };
    case "installing":
    case "checking":
      return {
        text: "text-accent-content",
        icon: "bg-accent-content/10 text-accent-content",
        dot: "bg-accent-content",
      };
    case "failed":
      return {
        text: "text-brick-600 dark:text-brick-400",
        icon: "bg-brick-500/10 text-brick-600 dark:text-brick-400",
        dot: "bg-brick-500",
      };
    default:
      return {
        text: "text-content-muted",
        icon: "bg-ink-200/60 text-content-muted",
        dot: "bg-ink-400",
      };
  }
}

function formatBytes(value: number, locale: string): string {
  if (!Number.isFinite(value) || value < 0) return frontendMessage("settings.dependencies.notReported");
  const units: readonly Intl.NumberFormatOptions["unit"][] = ["byte", "kilobyte", "megabyte", "gigabyte", "terabyte"];
  const power = value < 1000 ? 0 : Math.min(Math.floor(Math.log(value) / Math.log(1000)), units.length - 1);
  const amount = value / 1000 ** power;
  return new Intl.NumberFormat(locale, {
    maximumFractionDigits: amount >= 10 ? 0 : 1,
    maximumSignificantDigits: 3,
    style: "unit",
    unit: units[power],
    unitDisplay: "short",
  }).format(amount);
}

function formatDate(value: string, locale: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(date);
}
