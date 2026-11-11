import { useMemo, useState, type ReactNode } from "react";
import type { AgentRuntimeDependencySnapshot } from "../../../api/eventTypes";
import { formatFrontendList, frontendMessage, type FrontendMessageKey } from "../../../i18n/frontendMessageCatalog";
import { resolveFrontendLocalizedText, type FrontendLocale } from "../../../i18n/frontendLocaleModel";
import { useFrontendLocale } from "../../../i18n/useFrontendLocale";
import { cn, formatFileSize } from "../../../lib/util";
import { resolveRuntimeTimeZone } from "../../../config/runtimeConfig";
import {
  AppIcon,
  Button,
  IconButton,
  ScrollArea,
  StateView,
  useClipboardCopy,
  type AppIconName,
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
        icon={<AppIcon icon="server" size={20} aria-hidden="true" />}
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
    <ScrollArea className="h-full min-h-0 bg-surface-canvas" viewportClassName="h-full">
      <section className="mx-auto w-full max-w-[920px] px-5 py-5 sm:px-8" data-runtime-dependencies>
        <div className="mb-2 flex justify-end">
          <IconButton
            label={frontendMessage("settings.dependencies.refresh")}
            size="sm"
            tone="muted"
            disabled={!connected}
            onClick={() => systemConfig.refreshRuntimeDependencies()}
          >
            <AppIcon icon="refresh" size={16} />
          </IconButton>
        </div>
        <div className="divide-y divide-line-subtle border-b border-line-subtle">
          {dependencies.map((dependency) => {
            const expanded = selectedId === dependency.id;
            return (
              <div key={dependency.id}>
                <button
                  type="button"
                  aria-expanded={expanded}
                  aria-controls={`dependency-${dependency.id}`}
                  onClick={() => setSelectedId(expanded ? null : dependency.id)}
                  className="flex w-full items-start gap-3 py-5 text-left outline-none focus-visible:ring-2 focus-visible:ring-accent-focus"
                >
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-line text-content-secondary">
                    <AppIcon icon={runtimeDependencyIcon(dependency.kind)} size={20} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                      <span className="text-[14px] font-medium text-content-primary">
                        {resolveFrontendLocalizedText(dependency.displayName, locale)}
                      </span>
                      <span className={cn("text-[11px]", statusTone(dependency.status).text)}>
                        {frontendMessage(statusMessageKeys[dependency.status])}
                      </span>
                    </span>
                    <span
                      className={cn("mt-1 block text-xs leading-6 text-content-muted", !expanded && "line-clamp-2")}
                    >
                      {resolveFrontendLocalizedText(dependency.description, locale)}
                    </span>
                  </span>
                  <AppIcon
                    icon="chevron-down"
                    size={16}
                    className={cn("mt-3 shrink-0 text-content-muted transition-transform", expanded && "rotate-180")}
                  />
                </button>
                {expanded ? (
                  <div id={`dependency-${dependency.id}`}>
                    <DependencyDetail dependency={dependency} locale={locale} systemConfig={systemConfig} />
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </section>
    </ScrollArea>
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
  const connected = systemConfig.socketStatus === "open";
  const percent = dependency.percent === undefined ? undefined : Math.max(0, Math.min(100, dependency.percent));
  const { copied, copyText } = useClipboardCopy({ successMessage: frontendMessage("settings.action.copied") });
  return (
    <div className="pb-5 sm:pl-[52px]">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <dl className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-content-secondary">
          {dependency.version ? (
            <div>
              <dt className="sr-only">{frontendMessage("settings.dependencies.version")}</dt>
              <dd>v{dependency.version}</dd>
            </div>
          ) : null}
          {dependency.sizeBytes !== undefined ? (
            <div>
              <dt className="sr-only">{frontendMessage("settings.dependencies.size")}</dt>
              <dd>{formatBytes(dependency.sizeBytes, locale)}</dd>
            </div>
          ) : null}
          <div className="flex gap-1.5 text-content-muted">
            <dt>{frontendMessage("settings.dependencies.checkedAt")}</dt>
            <dd>{formatDate(dependency.checkedAt, locale)}</dd>
          </div>
        </dl>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <IconButton
            label={frontendMessage("settings.dependencies.checkShort")}
            tooltip={frontendMessage("settings.dependencies.checkShort")}
            tone="muted"
            touchSafe
            loading={busy}
            disabled={busy || !connected}
            onClick={() => systemConfig.checkRuntimeDependency(dependency.id)}
          >
            <AppIcon icon="refresh" size={16} />
          </IconButton>
          {dependency.installable ? (
            <Button
              size="sm"
              variant="ghost"
              disabled={busy || !connected}
              onClick={() => systemConfig.installRuntimeDependency(dependency.id)}
            >
              <AppIcon icon="download" size={14} />
              {frontendMessage(
                dependency.status === "ready" ? "settings.dependencies.reinstall" : "settings.dependencies.install",
              )}
            </Button>
          ) : null}
        </div>
      </div>
      {busy ? (
        <div className="mt-3 space-y-2" aria-live="polite">
          <div className="flex items-center justify-between gap-3 text-xs text-content-secondary">
            <span>
              {formatDependencyPhase(dependency.phase) ?? frontendMessage(statusMessageKeys[dependency.status])}
            </span>
            {percent !== undefined ? <span className="tabular-nums">{Math.round(percent)}%</span> : null}
          </div>
          {percent !== undefined ? (
            <div
              role="progressbar"
              aria-label={frontendMessage("settings.dependencies.installation")}
              aria-valuenow={percent}
              aria-valuemin={0}
              aria-valuemax={100}
              className="h-1 overflow-hidden rounded-full bg-surface-subtle"
            >
              <div
                className="h-full bg-accent-solid transition-[width] motion-reduce:transition-none"
                style={{ width: `${percent}%` }}
              />
            </div>
          ) : null}
          {dependency.transferredBytes !== undefined && dependency.totalBytes !== undefined ? (
            <p className="text-[11px] text-content-muted">
              {frontendMessage("settings.dependencies.transferProgress", {
                current: formatBytes(dependency.transferredBytes, locale),
                total: formatBytes(dependency.totalBytes, locale),
              })}
              {dependency.bytesPerSecond !== undefined
                ? ` · ${frontendMessage("settings.dependencies.transferRate", { value: formatBytes(dependency.bytesPerSecond, locale) })}`
                : ""}
            </p>
          ) : null}
        </div>
      ) : null}
      {dependency.message ? (
        <p className={cn("mt-2 text-xs leading-6", statusTone(dependency.status).text)}>{dependency.message}</p>
      ) : null}
      <details className="group/dependency-info mt-3">
        <summary className="flex w-fit cursor-pointer list-none items-center gap-1.5 text-xs text-content-muted outline-none hover:text-content-primary focus-visible:ring-2 focus-visible:ring-accent-focus [&::-webkit-details-marker]:hidden">
          {frontendMessage("settings.dependencies.details")}
          <AppIcon
            icon="chevron-right"
            size={13}
            className="transition-transform group-open/dependency-info:rotate-90"
          />
        </summary>
        <dl className="mt-3 space-y-3 text-xs">
          {dependency.path ? (
            <DependencyDetailRow label={frontendMessage("settings.dependencies.path")}>
              <span className="flex items-start gap-2">
                <code className="min-w-0 flex-1 select-text break-all text-[11px] leading-5">{dependency.path}</code>
                <IconButton
                  size="sm"
                  tone="muted"
                  label={frontendMessage("settings.dependencies.copyPath")}
                  onClick={() => void copyText(dependency.path!)}
                >
                  <AppIcon icon={copied ? "checkmark" : "copy"} size={13} />
                </IconButton>
              </span>
            </DependencyDetailRow>
          ) : null}
          {dependency.cachePath ? (
            <DependencyDetailRow label={frontendMessage("settings.dependencies.cachePath")}>
              <code className="select-text break-all text-[11px] leading-5">{dependency.cachePath}</code>
            </DependencyDetailRow>
          ) : null}
          {dependency.cacheStatus === "available" || dependency.cacheStatus === "missing" ? (
            <DependencyDetailRow label={frontendMessage("settings.dependencies.cache")}>
              {frontendMessage(
                dependency.cacheStatus === "available"
                  ? "settings.dependencies.cacheAvailable"
                  : "settings.dependencies.cacheMissing",
              )}
            </DependencyDetailRow>
          ) : null}
          {dependency.capabilities.length ? (
            <DependencyDetailRow label={frontendMessage("settings.dependencies.capabilities")}>
              {formatFrontendList(dependency.capabilities, locale)}
            </DependencyDetailRow>
          ) : null}
        </dl>
      </details>
    </div>
  );
}

function DependencyDetailRow({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <div className="grid gap-1.5 sm:grid-cols-[90px_minmax(0,1fr)] sm:gap-4">
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

function runtimeDependencyIcon(kind: AgentRuntimeDependencySnapshot["kind"]): AppIconName {
  return kind === "browser" ? "globe" : "server";
}

function statusTone(status: AgentRuntimeDependencySnapshot["status"]): {
  readonly text: string;
} {
  switch (status) {
    case "ready":
      return {
        text: "text-emerald-600 dark:text-emerald-400",
      };
    case "installing":
    case "checking":
      return {
        text: "text-accent-content",
      };
    case "failed":
      return {
        text: "text-brick-600 dark:text-brick-400",
      };
    default:
      return {
        text: "text-content-muted",
      };
  }
}

function formatBytes(value: number, locale: string): string {
  if (!Number.isFinite(value) || value < 0) return frontendMessage("settings.dependencies.notReported");
  return formatFileSize(value, { locale });
}

function formatDate(value: string, locale: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: resolveRuntimeTimeZone(),
  }).format(date);
}
