import { Tooltip } from "../../../shared/ui/Tooltip";
import { useCallback, useEffect, useMemo, useState, type JSX } from "react";
import { frontendMessage } from "../../../i18n/frontendMessageCatalog";
import { useFrontendLocale } from "../../../i18n/useFrontendLocale";
import { cn } from "../../../lib/util";
import { JsonConfigSettingsView } from "../../../shared/config/JsonConfigForm";
import { isJsonConfigObject } from "../../../shared/config/JsonConfigValue";
import { AppIcon, IconButton, InlineError, ScrollArea, StateView, Switch, useClipboardCopy } from "../../../shared/ui";
import type { SettingsSystemConfigHandle } from "../SettingsContracts";
import { projectSystemExtensionConfigurationSections } from "../systemExtensionConfigurationPresentation";
import { readSettingsExtensionDraft, writeSettingsExtensionDraft } from "./SystemToolsSection";
import type { ConfigSettingsDraftState, ConfigDraftSaveMode } from "./configSettingsDraftState";
import { projectSectionConfigFields } from "./runtimeModelAssignments";
import { AgentSystemExtensionSettingsSurfaces } from "../../../../../Source/AgentSystem/Types/AgentSystemExtensionSettingsSurface";
import { ClientExtensionSettings } from "./ClientExtensionSettings";
import { PluginIdentityIcon, PluginIdentityTile } from "./PluginIdentityIcon";
import { PluginDocumentation } from "./PluginDocumentation";
import { PluginSkills } from "./PluginSkills";
import { SettingsSectionLoading } from "../SettingsLoading";

const ChannelSectionIds = ["telegram", "qq", "discord", "onebot11", "onebot"] as const;

type ChannelSectionId = (typeof ChannelSectionIds)[number];

type ChannelEntryId = "general" | ChannelSectionId;

const ChannelEntryMarks: Record<ChannelSectionId, string> = {
  telegram: "Telegram",
  qq: "QQ",
  discord: "Discord",
  onebot11: "Senera QQ",
  onebot: "OneBot 11",
};

const ChannelStatusPresentation = {
  stopped: { label: "settings.channels.disconnected", text: "text-content-muted", icon: "wifi-off" },
  connecting: { label: "settings.channels.connecting", text: "text-umber-600", icon: "loading" },
  connected: { label: "settings.channels.connected", text: "text-moss-600", icon: "wifi" },
  reconnecting: { label: "settings.channels.reconnecting", text: "text-umber-600", icon: "loading" },
  degraded: { label: "settings.channels.degraded", text: "text-brick-600", icon: "alert" },
} as const;

function ChannelIdentity({ id }: { id: ChannelEntryId }): JSX.Element {
  return (
    <PluginIdentityTile>
      {id === "general" ? (
        <AppIcon icon="sliders" size={24} />
      ) : (
        <PluginIdentityIcon brandIcon={id === "onebot11" || id === "onebot" ? "qq" : id} size={28} />
      )}
    </PluginIdentityTile>
  );
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
  const channelExtension =
    extensions.find((extension) => extension.settingsSurface === AgentSystemExtensionSettingsSurfaces.Channels) ?? null;
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

  const readSecret = useMemo(() => {
    if (!channelExtension || !systemConfig) return undefined;
    const extensionId = channelExtension.id;
    const selectedPathPrefix = selectedId && selectedId !== "general" ? [selectedId] : [];
    return (field: import("../../../api/eventTypes").ConfigFormFieldData): Promise<string> =>
      systemConfig.readExtensionSecret(extensionId, [...selectedPathPrefix, ...field.path]);
  }, [channelExtension, selectedId, systemConfig]);

  useEffect(() => {
    if (!channelExtension) setSelectedId(null);
  }, [channelExtension]);

  if (!systemConfig || !systemConfig.toolSettingsSynced.systemTools) {
    return <SettingsSectionLoading variant="directory" />;
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
      <AppIcon icon="refresh" size={16} aria-hidden="true" />
    </IconButton>
  );

  if (!channelExtension) {
    return (
      <section className="flex h-full min-h-0 flex-col overflow-hidden bg-surface-canvas">
        <ChannelsHeader refreshButton={refreshButton} />
        <StateView
          status="empty"
          className="min-h-64"
          icon={<AppIcon icon="package" size={16} className="text-ink-400" />}
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
            <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,320px),1fr))] gap-x-8 gap-y-1">
              {(["general", ...ChannelSectionIds] as ChannelEntryId[]).map((entryId) => {
                const section = entryId === "general" ? general : sections.find((other) => other.name === entryId);
                if (!section) return null;
                const mark =
                  entryId === "general"
                    ? frontendMessage("settings.channels.generalTitle")
                    : entryId === "onebot11"
                      ? frontendMessage("settings.channels.localName")
                      : ChannelEntryMarks[entryId];
                const channelValue = isJsonConfigObject(configuration[entryId]) ? configuration[entryId] : {};
                const rowEnabled =
                  entryId === "general"
                    ? enabled
                    : typeof channelValue.enabled === "boolean"
                      ? channelValue.enabled
                      : false;
                const status =
                  entryId === "general"
                    ? undefined
                    : systemConfig.channelStatuses.find((item) => item.kind === entryId);
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
      : entryId === "onebot11"
        ? frontendMessage("settings.channels.localName")
        : ChannelEntryMarks[entryId];
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
      <div className="mx-auto flex w-full max-w-[924px] shrink-0 flex-wrap items-center justify-between gap-3 border-b border-line-subtle px-5 py-4 sm:px-8">
        <div className="flex min-w-0 items-center gap-3">
          <IconButton
            label={frontendMessage("settings.tools.backToExtensions")}
            size="sm"
            tone="muted"
            onClick={() => setSelectedId(null)}
          >
            <AppIcon icon="arrow-left" size={16} />
          </IconButton>
          <ChannelIdentity id={entryId} />
          <div className="min-w-0">
            <h3 className="flex items-center gap-2 text-[18px] font-semibold tracking-[-0.01em] text-content-primary">
              {channelKind ? <ChannelStatusGlyph status={channelStatus} /> : null}
              {mark}
            </h3>
          </div>
        </div>
        <div className="ml-auto flex shrink-0 flex-wrap items-center gap-2">
          {channelKind ? (
            <IconButton
              label={frontendMessage(
                channelStatus?.state === "connected" ? "settings.channels.reconnect" : "settings.channels.connect",
              )}
              tooltip={frontendMessage(
                channelStatus?.state === "connected" ? "settings.channels.reconnect" : "settings.channels.connect",
              )}
              tone="muted"
              touchSafe
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
              <AppIcon icon="refresh" size={16} aria-hidden="true" />
            </IconButton>
          ) : null}
          <span className="grid shrink-0 justify-items-center gap-2 self-start pt-1">
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
        <div className="mx-auto w-full max-w-[924px] px-5 py-5 sm:px-8">
          {channelKind === "onebot11" && systemConfig.oneBot11ClientUrl && systemConfig.workspaceId ? (
            <ClientExtensionSettings
              key={systemConfig.workspaceId}
              url={systemConfig.oneBot11ClientUrl}
              workspaceId={systemConfig.workspaceId}
              connected={channelStatus?.state === "connected"}
            />
          ) : null}
          <PluginDocumentation
            key={`documentation:${entryId}`}
            content={section.documentation}
            summary={section.description}
          />
          <PluginSkills key={`skills:${entryId}`} skills={channelExtension.skills} />
          {channelKind ? <ChannelConnectionStatus status={channelStatus} /> : null}
          {withoutEnabled.fields.length > 0 ? (
            <JsonConfigSettingsView
              layoutMode="embedded"
              showSectionHeading={false}
              sections={[withoutEnabled]}
              value={entryId === "general" ? configuration : channelValue}
              disabled={!connected}
              readSecret={readSecret}
              onChange={(next, mode) => {
                if (entryId === "general") {
                  updateExtension(enabled, stripUndefined(next), mode ?? "debounced");
                } else {
                  updateChannel(entryId as ChannelSectionId, next, mode ?? "debounced");
                }
              }}
              onCommit={draftState.flushSave}
            />
          ) : null}
        </div>
      </ScrollArea>
    </section>
  );
}

function ChannelsHeader({ refreshButton }: { refreshButton: JSX.Element }): JSX.Element {
  return (
    <div className="mx-auto flex w-full max-w-[980px] shrink-0 items-center justify-between gap-4 border-b border-line px-6 py-4 lg:px-8">
      <div>
        <h2 className="text-[13px] font-semibold text-content-primary">
          {frontendMessage("settings.section.channels.label")}
        </h2>
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
  return (
    <div
      className={cn(
        "group flex w-full min-w-0 items-start gap-3 border-b border-line-subtle py-5 text-left",
        entryId === "general" && "col-span-full mb-1",
      )}
      data-channels-entry={entryId}
    >
      <button
        type="button"
        onClick={onSelect}
        className="flex w-0 min-w-0 flex-1 items-start gap-3.5 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-accent-focus"
      >
        <ChannelIdentity id={entryId} />
        <span className="min-w-0 flex-1">
          <span className="flex h-6 items-center gap-2">
            {entryId !== "general" ? <ChannelStatusGlyph status={status} /> : null}
            <span className="truncate text-[13px] font-medium text-content-primary group-hover:text-content-strong">
              {mark}
            </span>
          </span>
          <span className="mt-1 line-clamp-2 text-xs leading-5 text-content-secondary">{description}</span>
        </span>
      </button>
      <span className="grid shrink-0 justify-items-center gap-2 pt-1">
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

function ChannelStatusGlyph({
  status,
}: {
  status?: Pick<SettingsSystemConfigHandle["channelStatuses"][number], "state">;
}): JSX.Element | null {
  if (!status) return null;
  const presentation = ChannelStatusPresentation[status.state];
  const label = frontendMessage(presentation.label);
  return (
    <Tooltip content={label}>
      <span
        role="img"
        aria-label={label}

        data-channel-connection-state={status.state}
        className={cn("grid h-4 w-4 place-items-center", presentation.text)}
      >
        <AppIcon icon={presentation.icon} size={14} />
      </span>
    </Tooltip>
  );
}

function ChannelConnectionStatus({
  status,
}: {
  status?: SettingsSystemConfigHandle["channelStatuses"][number];
}): JSX.Element | null {
  const { copied, copyText } = useClipboardCopy({ successMessage: frontendMessage("settings.action.copied") });
  if (!status) return null;
  return (
    <div className="mb-3">
      {status.error ? <p className="mt-1.5 text-[11px] leading-4 text-brick-600">{status.error}</p> : null}
      {status.connection?.endpoint ? (
        <div className="mt-2 flex min-w-0 items-start gap-1.5 text-[11px] leading-4 text-content-secondary">
          <div className="min-w-0 flex-1">
            <span className="mr-1 text-content-muted">
              {status.connection.accountId ? `#${status.connection.accountId}` : ""}
            </span>
            <code className="select-text break-all font-mono text-content-primary">{status.connection.endpoint}</code>
          </div>
          <IconButton
            label={frontendMessage("settings.action.copy")}
            tooltip={copied ? frontendMessage("settings.action.copied") : frontendMessage("settings.action.copy")}
            size="sm"
            tone="muted"
            onClick={() => void copyText(status.connection!.endpoint!)}
          >
            <AppIcon icon={copied ? "check" : "copy"} size={13} aria-hidden="true" />
          </IconButton>
        </div>
      ) : null}
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
