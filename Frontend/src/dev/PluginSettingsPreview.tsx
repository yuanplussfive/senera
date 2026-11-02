import { useMemo, useState } from "react";
import type { SystemExtensionSettingsItem } from "../api/eventTypes";
import type {
  AgentSystemExtensionManifest,
  AgentSystemToolContract,
} from "../../../Source/AgentSystem/SystemTools/AgentSystemExtensionManifest";
import { resolveAgentSystemToolPresentation } from "../../../Source/AgentSystem/SystemTools/AgentSystemToolPresentation";
import { createAgentExtensionLocalizedText } from "../../../Source/AgentSystem/Extensions/AgentExtensionLocalization";
import type { SettingsSystemConfigHandle } from "../features/settings/SettingsContracts";
import type { ConfigSettingsDraftState } from "../features/settings/sections/configSettingsDraftState";
import { PluginsSection } from "../features/settings/sections/PluginsSection";
import { ChannelsSection } from "../features/settings/sections/ChannelsSection";
import { RuntimeDependenciesSection } from "../features/settings/sections/RuntimeDependenciesSection";
import { AgentRuntimeDependencyCatalog } from "../../../Source/AgentSystem/Runtime/AgentRuntimeDependencyCatalog";
import { projectConfigFormField } from "../../../Source/AgentSystem/Config/AgentConfigFormFieldProjector";
import type { LocalizedConfigFormDocument } from "../../../Source/AgentSystem/Config/AgentConfigFormDocument";
const forms = import.meta.glob<LocalizedConfigFormDocument>("../../../System/Extensions/*/*/ui.schema.json", {
  eager: true,
  import: "default",
});
const previewChannelValue = {
  enabled: true,
  telegram: { enabled: false },
  qq: { enabled: true },
  discord: { enabled: false },
  onebot11: { enabled: true },
  onebot: {
    enabled: true,
    wsUrl: "ws://127.0.0.1:3001",
    expectedSelfId: "123456789",
    ownerQq: "987654321",
    groupAllowedUsers: ["876543210"],
  },
};

const domains = import.meta.glob<SystemExtensionSettingsItem["domain"]>("../../../System/Extensions/*/domain.json", {
  eager: true,
  import: "default",
});
const manifests = import.meta.glob<AgentSystemExtensionManifest>("../../../System/Extensions/*/*/extension.json", {
  eager: true,
  import: "default",
});
const contracts = import.meta.glob<AgentSystemToolContract>("../../../System/Extensions/*/*/**/*.tool.json", {
  eager: true,
  import: "default",
});

// Read the same package declarations as the host. Stories contain no parallel icon or copy catalog.
const extensions: SystemExtensionSettingsItem[] = Object.entries(manifests)
  .sort(([, left], [, right]) => (right.priority ?? 0) - (left.priority ?? 0))
  .map(([path, manifest]) => {
    const domain = Object.values(domains).find((item) => item.id === manifest.domain)!;
    const presentation = resolveAgentSystemToolPresentation(domain.presentation, manifest.presentation);
    const contributions = manifest.contributions ?? [];
    const tools = contributions.flatMap((item) => {
      if (item.kind !== "hostTool") return [];
      const contract = contracts[`${path.slice(0, path.lastIndexOf("/"))}/${item.contract}`];
      return [
        {
          name: contract.name,
          description:
            typeof contract.description === "string"
              ? createAgentExtensionLocalizedText(contract.description)
              : contract.description,
          loading: contract.loading,
          capability: item.capability,
          presentation: resolveAgentSystemToolPresentation(
            domain.presentation,
            manifest.presentation,
            contract.presentation,
          ),
        },
      ];
    });
    const form = manifest.configuration?.ui
      ? forms[`${path.slice(0, path.lastIndexOf("/"))}/${manifest.configuration.ui}`]
      : undefined;
    const value = manifest.settingsSurface === "channels" ? previewChannelValue : {};
    return {
      ...(form
        ? {
            configuration: {
              configured: true,
              value,
              effectiveValue: value,
              defaults: {},
              sections: (form.form.sections ?? []).map((section) => ({
                name: section.id,
                label: section.label,
                description: section.description,
                documentation: section.documentation,
                keyCount: section.fields?.length ?? 0,
                fields: (section.fields ?? []).map((field) =>
                  projectConfigFormField({
                    field,
                    section: section.id,
                    source: value,
                    inheritedSource: {},
                    effectiveSource: value,
                    basePath: [],
                  }),
                ),
              })),
            },
          }
        : {}),
      id: manifest.id,
      settingsSurface: manifest.settingsSurface,
      domain,
      displayName: manifest.displayName,
      description: manifest.description,
      usageExamples: manifest.usageExamples,
      documentation: manifest.documentation,
      presentation,
      enabled: true,
      configured: false,
      tools,
      skillCount: contributions.filter((item) => item.kind === "skill").length,
      mcpServerCount: contributions.filter((item) => item.kind === "mcpServer").length,
    };
  });

const noop = (): void => {};
const unavailable = (): null => null;

export function PluginSettingsPreview({
  surface = "plugins",
}: {
  surface?: "plugins" | "channels" | "dependencies";
}): JSX.Element {
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const draftState: ConfigSettingsDraftState = {
    draft,
    updateDraft: setDraft,
    diagnostics: [],
    dirty: false,
    localError: null,
    saving: false,
    savedRecently: false,
    conflict: false,
    validationErrors: [],
    flushSave: noop,
    refreshOrRestore: noop,
    save: noop,
  };
  const systemConfig = useMemo<SettingsSystemConfigHandle>(
    () => ({
      socketStatus: "open",
      workspaceId: "preview",
      configSnapshot: null,
      configOperation: null,
      systemTools: [],
      systemExtensions: extensions,
      mcpServers: [],
      runtimeDependencies: AgentRuntimeDependencyCatalog.map((dependency, index) => ({
        ...dependency,
        status: "ready",
        checkedAt: "2026-10-25T10:55:00.000Z",
        version: index === 0 ? "0.39.1" : undefined,
        sizeBytes: index === 1 ? 5440000 : undefined,
        path: index === 0 ? "C:\\Senera\\runtime\\agent-browser.exe" : "C:\\Senera\\runtime\\chromium\\chrome.exe",
        cachePath: index === 1 ? "C:\\Senera\\cache\\browsers" : undefined,
      })),
      channelStatuses: [
        { kind: "qq", state: "connected", enabled: true, connected: true },
        {
          kind: "onebot",
          state: "connected",
          enabled: true,
          connected: true,
          connection: {
            accountId: "123456789",
            endpoint: "ws://127.0.0.1:3001/",
          },
        },
      ],
      mcpInputOperation: null,
      toolSettingsSynced: { systemTools: true, mcpServers: true },
      providerEndpointOperations: {},
      providerModelOperations: {},
      providerModelLoadingIds: {},
      providerModelCatalogs: {},
      providerModelErrors: {},
      readProviderApiKey: async () => "",
      readExtensionSecret: async () => "",
      refreshConfig: noop,
      saveConfig: unavailable,
      fetchProviderModels: noop,
      upsertProviderEndpoint: unavailable,
      renameProviderEndpoint: unavailable,
      deleteProviderEndpoint: unavailable,
      upsertProviderModel: unavailable,
      deleteProviderModel: unavailable,
      setDefaultProviderModel: unavailable,
      ingestConfigMutationEvent: () => false,
      refreshToolSettings: () => true,
      refreshRuntimeDependencies: () => true,
      checkRuntimeDependency: () => true,
      installRuntimeDependency: () => true,
      updateMcpInputs: unavailable,
      restartMcpServer: () => true,
      connectChannel: () => true,
    }),
    [],
  );
  if (surface === "dependencies") return <RuntimeDependenciesSection systemConfig={systemConfig} />;
  if (surface === "channels") return <ChannelsSection draftState={draftState} systemConfig={systemConfig} />;
  return <PluginsSection draftState={draftState} systemConfig={systemConfig} />;
}
