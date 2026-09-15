import { useCallback, useEffect, useMemo, useState, type JSX } from "react";
import AdjustmentsHorizontalIcon from "@heroicons/react/24/outline/AdjustmentsHorizontalIcon";
import ArrowLeftIcon from "@heroicons/react/24/outline/ArrowLeftIcon";
import ArrowPathIcon from "@heroicons/react/24/outline/ArrowPathIcon";
import CubeTransparentIcon from "@heroicons/react/24/outline/CubeTransparentIcon";
import PaperAirplaneIcon from "@heroicons/react/24/outline/PaperAirplaneIcon";
import ServerStackIcon from "@heroicons/react/24/outline/ServerStackIcon";
import UsersIcon from "@heroicons/react/24/outline/UsersIcon";
import { frontendMessage } from "../../../i18n/frontendMessageCatalog";
import { useFrontendLocale } from "../../../i18n/useFrontendLocale";
import { JsonConfigSettingsView } from "../../../shared/config/JsonConfigForm";
import { isJsonConfigObject } from "../../../shared/config/JsonConfigValue";
import { Button, IconButton, InlineError, ScrollArea, StateView, Switch } from "../../../shared/ui";
import type { SettingsSystemConfigHandle } from "../SettingsContracts";
import { projectSystemExtensionConfigurationSections } from "../systemExtensionConfigurationPresentation";
import { readSettingsExtensionDraft, writeSettingsExtensionDraft } from "./SystemToolsSection";
import type { ConfigSettingsDraftState, ConfigDraftSaveMode } from "./configSettingsDraftState";
import { projectSectionConfigFields } from "./runtimeModelAssignments";

const ChannelsExtensionId = "agent-channels";

const ChannelSectionIds = ["telegram", "qq", "discord"] as const;

type ChannelSectionId = (typeof ChannelSectionIds)[number];

type ChannelEntryId = "general" | ChannelSectionId;

const ChannelEntryMarks: Record<ChannelSectionId, string> = {
  telegram: "Telegram",
  qq: "QQ",
  discord: "Discord",
};

const ChannelStatusPresentation = {
  stopped: { label: "settings.channels.disconnected", text: "text-content-muted", dot: "bg-ink-300" },
  connecting: { label: "settings.channels.connecting", text: "text-amber-600", dot: "bg-amber-500" },
  connected: { label: "settings.channels.connected", text: "text-emerald-600", dot: "bg-emerald-500" },
  reconnecting: { label: "settings.channels.reconnecting", text: "text-amber-600", dot: "bg-amber-500" },
  degraded: { label: "settings.channels.degraded", text: "text-brick-600", dot: "bg-brick-500" },
} as const;

function channelEntryIcon(entryId: ChannelEntryId): typeof CubeTransparentIcon {
  switch (entryId) {
    case "general":
      return AdjustmentsHorizontalIcon;
    case "telegram":
      return PaperAirplaneIcon;
    case "qq":
      return UsersIcon;
    case "discord":
      return ServerStackIcon;
  }
}

/**
 * Dedicated message-channel section using the same directory -> detail
 * interaction as the system tools. The gateway master switch and each
 * platform are separate plugin rows; opening one shows only that channel's
 * fields, so platforms never share a form.
 */
export function ChannelsSection({
  draftState,
  systemConfig,
}: {
  draftState: ConfigSettingsDraftState;
  systemConfig?: SettingsSystemConfigHandle;
}): JSX.Element {
  const locale = useFrontendLocale();
  const extensions = systemConfig?.systemExtensions ?? [];
  const channelExtension = extensions.find((extension) => extension.id === ChannelsExtensionId) ?? null;
  const connected = systemConfig?.socketStatus === "open";
  const draft = channelExtension ? readSettingsExtensionDraft(draftState.draft, channelExtension) : null;
  const enabled = draft?.enabled ?? true;
  const configuration = draft?.configuration ?? {};
  const [selectedId, setSelectedId] = useState<ChannelEntryId | null>(null);
  const [connectAfterSave, setConnectAfterSave] = useState<ChannelSectionId | null>(null);
  const [connectingId, setConnectingId] = useState<ChannelSectionId | null>(null);

  const connectChannel = systemConfig?.connectChannel;
  const requestConnection = useCallback(
    (kind: ChannelSectionId): void => {
      if (connectChannel?.(kind)) setConnectingId(kind);
    },
    [connectChannel],
  );

  useEffect(() => {
    if (!connectAfterSave || draftState.dirty || draftState.saving) return;
    if (draftState.localError || draftState.validationErrors.length > 0) {
      setConnectAfterSave(null);
      return;
    }
    requestConnection(connectAfterSave);
    setConnectAfterSave(null);
  }, [
    connectAfterSave,
    draftState.dirty,
    draftState.localError,
    draftState.saving,
    draftState.validationErrors.length,
    requestConnection,
  ]);

  useEffect(() => {
    if (!connectingId) return;
    const timer = window.setTimeout(() => setConnectingId(null), 15_000);
    return () => window.clearTimeout(timer);
  }, [connectingId]);

  useEffect(() => {
    if (!connectingId) return;
    const status = systemConfig?.channelStatuses.find((item) => item.kind === connectingId);
    if (status && status.state !== "connecting" && status.state !== "reconnecting") setConnectingId(null);
  }, [connectingId, systemConfig?.channelStatuses]);

  const sections = useMemo(() => {
    if (!channelExtension) return [];
    const projected = projectSystemExtensionConfigurationSections({
      sections: channelExtension.configuration?.sections ?? [],
      locale,
      configSnapshot: systemConfig?.configSnapshot ?? null,
    });
    const all = projected.map((section) => projectSectionConfigFields(section, projected));
    return all.filter((section) => section.fields.length > 0);
  }, [channelExtension, locale, systemConfig?.configSnapshot]);

  useEffect(() => {
    if (!channelExtension) setSelectedId(null);
  }, [channelExtension]);

  if (!systemConfig || !systemConfig.toolSettingsSynced.systemTools) {
    return (
      <div className="grid min-h-[180px] place-items-center text-[12px] text-content-muted">
        {frontendMessage("settings.tools.loading")}
      </div>
    );
  }

  const refreshButton = (
    <IconButton
      label={frontendMessage("settings.tools.refresh")}
      tooltip={frontendMessage("settings.tools.refresh")}
      size="sm"
      tone="muted"
      disabled={!connected || draftState.saving}
      onClick={() => {
        systemConfig.refreshConfig();
        systemConfig.refreshToolSettings();
      }}
    >
      <ArrowPathIcon className="h-4 w-4" />
    </IconButton>
  );

  if (!channelExtension) {
    return (
      <section className="flex h-full min-h-0 flex-col overflow-hidden bg-surface-canvas">
        <ChannelsHeader refreshButton={refreshButton} />
        <StateView
          status="empty"
          className="min-h-64"
          icon={<CubeTransparentIcon className="h-4 w-4 text-ink-400" />}
          title={frontendMessage("settings.channels.notPublished")}
        />
      </section>
    );
  }

  const general = sections.find((section) => section.name === "general");
  const selectedSection =
    selectedId === "general"
      ? general
      : selectedId
        ? sections.find((section) => section.name === selectedId)
        : undefined;

  const updateExtension = (
    nextEnabled: boolean,
    nextConfiguration: Record<string, unknown>,
    mode: ConfigDraftSaveMode,
  ): void => {
    if (!channelExtension) return;
    draftState.updateDraft(
      writeSettingsExtensionDraft(draftState.draft, channelExtension, nextEnabled, nextConfiguration),
      mode,
    );
  };

  const updateChannel = (id: ChannelSectionId, nextValue: Record<string, unknown>, mode: ConfigDraftSaveMode): void => {
    updateExtension(enabled, { ...configuration, [id]: stripUndefined(nextValue) }, mode);
  };

  if (!selectedId || !selectedSection) {
    return (
      <section className="flex h-full min-h-0 flex-col overflow-hidden bg-surface-canvas" data-channels-directory>
        <ChannelsHeader refreshButton={refreshButton} />
        <ScrollArea className="min-h-0 flex-1" viewportClassName="h-full">
          {draftState.localError ? (
            <InlineError className="mx-auto mt-4 max-w-[900px] px-6 lg:px-8">{draftState.localError}</InlineError>
          ) : null}
          <div className="mx-auto w-full max-w-[900px] px-6 py-5 lg:px-8">
            <p className="mb-5 text-[11.5px] leading-5 text-content-muted">
              {frontendMessage("settings.channels.connectionHint")}
            </p>
            {(["general", ...ChannelSectionIds] as ChannelEntryId[]).map((entryId) => {
              const section = entryId === "general" ? general : sections.find((other) => other.name === entryId);
              if (!section) return null;
              const mark =
                entryId === "general"
                  ? frontendMessage("settings.channels.generalTitle")
                  : ChannelEntryMarks[entryId as ChannelSectionId];
              const channelValue = isJsonConfigObject(configuration[entryId]) ? configuration[entryId] : {};
              const rowEnabled =
                entryId === "general"
                  ? enabled
                  : typeof channelValue.enabled === "boolean"
                    ? channelValue.enabled
                    : false;
              const status =
                entryId === "general" ? undefined : systemConfig.channelStatuses.find((item) => item.kind === entryId);
              return (
                <ChannelRow
                  key={entryId}
                  entryId={entryId}
                  mark={mark}
                  description={section.description ?? ""}
                  enabled={rowEnabled}
                  disabled={!connected}
                  status={status}
                  onToggle={(next) => {
                    if (entryId === "general") updateExtension(next, configuration, "debounced");
                    else {
                      updateChannel(entryId as ChannelSectionId, { ...channelValue, enabled: next }, "debounced");
                    }
                  }}
                  onSelect={() => setSelectedId(entryId)}
                />
              );
            })}
          </div>
        </ScrollArea>
      </section>
    );
  }

  const entryId = selectedId as ChannelEntryId;
  const section = selectedSection;
  const mark =
    entryId === "general"
      ? frontendMessage("settings.channels.generalTitle")
      : ChannelEntryMarks[entryId as ChannelSectionId];
  const channelValue = isJsonConfigObject(configuration[entryId]) ? configuration[entryId] : {};
  const currentEnabled =
    entryId === "general" ? enabled : typeof channelValue.enabled === "boolean" ? channelValue.enabled : false;
  const channelStatus =
    entryId === "general" ? undefined : systemConfig.channelStatuses.find((item) => item.kind === entryId);
  const channelKind = entryId === "general" ? null : (entryId as ChannelSectionId);
  const connectionPending = channelKind !== null && (connectingId === channelKind || connectAfterSave === channelKind);
  const withoutEnabled =
    entryId === "general"
      ? section
      : {
          ...section,
          // The form value is the channel sub-object, so field paths must be
          // rebased from ["qq","appId"] to ["appId"] for the nested view.
          fields: section.fields
            .filter((field) => field.path.at(-1) !== "enabled")
            .map((field) => ({ ...field, path: field.path.slice(1) })),
        };

  return (
    <section
      className="flex h-full min-h-0 flex-col overflow-hidden bg-surface-canvas"
      data-channels-detail
      data-channels-detail-id={entryId}
    >
      <div className="mx-auto flex w-full max-w-[900px] shrink-0 items-start justify-between gap-4 border-b border-line px-6 py-4 lg:px-8">
        <div className="flex min-w-0 items-start gap-3">
          <IconButton
            label={frontendMessage("settings.tools.backToExtensions")}
            size="sm"
            tone="muted"
            onClick={() => setSelectedId(null)}
          >
            <ArrowLeftIcon className="h-4 w-4" />
          </IconButton>
          <div className="min-w-0">
            <h3 className="flex items-center gap-2 truncate text-[17px] font-semibold tracking-[-0.01em] text-content-primary">
              {mark}
              <span className="text-[11px] font-normal text-content-muted">{section.label}</span>
            </h3>
            <p className="mt-1 max-w-[560px] text-[12px] leading-5 text-content-secondary">{section.description}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {channelKind ? (
            <Button
              size="sm"
              variant="outline"
              loading={connectionPending}
              disabled={!connected || !enabled || !currentEnabled || draftState.validationErrors.length > 0}
              onClick={() => {
                if (draftState.dirty || draftState.saving) {
                  setConnectAfterSave(channelKind);
                  draftState.save();
                  return;
                }
                requestConnection(channelKind);
              }}
            >
              <ArrowPathIcon className="h-3.5 w-3.5" />
              {frontendMessage(
                channelStatus?.state === "connected" ? "settings.channels.reconnect" : "settings.channels.connect",
              )}
            </Button>
          ) : null}
          <span className="grid place-items-center">
            <Switch
              checked={currentEnabled}
              size="sm"
              disabled={!connected}
              ariaLabel={frontendMessage("settings.channels.enabledLabel", { name: mark })}
              onCheckedChange={(next) => {
                if (entryId === "general") updateExtension(next, configuration, "debounced");
                else updateChannel(entryId as ChannelSectionId, { ...channelValue, enabled: next }, "debounced");
              }}
            />
          </span>
        </div>
      </div>
      <ScrollArea className="min-h-0 flex-1" viewportClassName="h-full">
        {draftState.localError ? (
          <InlineError className="mx-auto mt-4 max-w-[900px] px-6 lg:px-8">{draftState.localError}</InlineError>
        ) : null}
        <div className="mx-auto w-full max-w-[820px] px-6 py-6 lg:px-8">
          {channelKind ? <ChannelConnectionStatus status={channelStatus} /> : null}
          <JsonConfigSettingsView
            layoutMode="embedded"
            sections={[withoutEnabled]}
            value={entryId === "general" ? configuration : channelValue}
            disabled={!connected}
            onChange={(next, mode) => {
              if (entryId === "general") {
                updateExtension(enabled, stripUndefined(next), mode ?? "debounced");
              } else {
                updateChannel(entryId as ChannelSectionId, next, mode ?? "debounced");
              }
            }}
            onCommit={draftState.flushSave}
          />
        </div>
      </ScrollArea>
    </section>
  );
}

function ChannelsHeader({ refreshButton }: { refreshButton: JSX.Element }): JSX.Element {
  return (
    <div className="mx-auto flex w-full max-w-[980px] shrink-0 items-center justify-between gap-4 border-b border-line px-6 py-4 lg:px-8">
      <div>
        <div className="text-[13px] font-semibold text-content-primary">
          {frontendMessage("settings.section.channels.label")}
        </div>
        <p className="mt-1 max-w-[640px] text-[11px] leading-5 text-content-muted">
          {frontendMessage("settings.section.channels.description")}
        </p>
      </div>
      {refreshButton}
    </div>
  );
}

function ChannelRow({
  entryId,
  mark,
  description,
  enabled,
  disabled,
  status,
  onToggle,
  onSelect,
}: {
  entryId: ChannelEntryId;
  mark: string;
  description: string;
  enabled: boolean;
  disabled: boolean;
  status?: SettingsSystemConfigHandle["channelStatuses"][number];
  onToggle: (next: boolean) => void;
  onSelect: () => void;
}): JSX.Element {
  const Icon = channelEntryIcon(entryId);
  return (
    <div
      className="flex min-h-[68px] w-full min-w-0 items-center gap-3 border-b border-line px-1 py-3 text-left transition-colors hover:bg-surface-hover"
      data-channels-entry={entryId}
    >
      <button type="button" onClick={onSelect} className="flex w-0 min-w-0 flex-1 items-center gap-3 text-left">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-surface-subtle text-content-secondary">
          <Icon className="h-5 w-5" aria-hidden="true" />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-[12.5px] font-semibold text-content-primary">{mark}</span>
          <span className="mt-0.5 line-clamp-2 text-[10.5px] leading-4 text-content-muted">{description}</span>
        </span>
      </button>
      {entryId !== "general" ? <ChannelStatusBadge status={status} /> : null}
      <span className="shrink-0">
        <Switch
          checked={enabled}
          size="sm"
          disabled={disabled}
          ariaLabel={frontendMessage("settings.channels.enabledLabel", { name: mark })}
          onCheckedChange={onToggle}
        />
      </span>
    </div>
  );
}

function ChannelStatusBadge({
  status,
}: {
  status?: SettingsSystemConfigHandle["channelStatuses"][number];
}): JSX.Element | null {
  if (!status) return null;
  const presentation = ChannelStatusPresentation[status.state];
  return (
    <span className={`inline-flex shrink-0 items-center gap-1.5 text-[10.5px] ${presentation.text}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${presentation.dot}`} />
      {frontendMessage(presentation.label)}
    </span>
  );
}

function ChannelConnectionStatus({
  status,
}: {
  status?: SettingsSystemConfigHandle["channelStatuses"][number];
}): JSX.Element | null {
  if (!status) return null;
  return (
    <div className="mb-5 rounded-lg border border-line bg-surface-subtle px-3 py-2.5">
      <ChannelStatusBadge status={status} />
      {status.error ? <p className="mt-1.5 text-[11px] leading-4 text-brick-600">{status.error}</p> : null}
    </div>
  );
}

function stripUndefined(value: Record<string, unknown>): Record<string, unknown> {
  const cleaned: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry === undefined) continue;
    if (entry === null) {
      cleaned[key] = entry;
      continue;
    }
    if (typeof entry === "object" && !Array.isArray(entry)) {
      cleaned[key] = stripUndefined(entry as Record<string, unknown>);
      continue;
    }
    cleaned[key] = entry;
  }
  return cleaned;
}
