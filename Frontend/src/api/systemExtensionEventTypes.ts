import type { AgentSystemExtensionSettingsSurface } from "../../../Source/AgentSystem/Types/AgentSystemExtensionSettingsSurface";
import type { AgentToolPresentation } from "../../../Source/AgentSystem/Types/AgentToolPresentationTypes";
import type { FrontendLocalizedText } from "../i18n/frontendLocaleModel";
import type { ConfigFormSectionData } from "./configFormEventTypes";

export interface SystemToolSettingsItem {
  name: string;
  title: string;
  description: string;
  extension: string;
  loading: string;
}

export interface SystemExtensionToolSettingsItem {
  name: string;
  description: FrontendLocalizedText;
  loading: string;
  capability: string;
  presentation: AgentToolPresentation;
}

export interface SystemExtensionConfigurationSettings {
  configured: boolean;
  value: Record<string, unknown>;
  effectiveValue: Record<string, unknown>;
  defaults: Record<string, unknown>;
  sections: ConfigFormSectionData<FrontendLocalizedText>[];
}

export interface SystemExtensionSettingsItem {
  id: string;
  settingsSurface: AgentSystemExtensionSettingsSurface;
  domain: {
    id: string;
    displayName: FrontendLocalizedText;
    description: FrontendLocalizedText;
    presentation: AgentToolPresentation;
  };
  version: string;
  displayName: FrontendLocalizedText;
  description: FrontendLocalizedText;
  presentation: AgentToolPresentation;
  enabled: boolean;
  configured: boolean;
  priority?: number;
  tools: SystemExtensionToolSettingsItem[];
  skillCount: number;
  mcpServerCount: number;
  configuration?: SystemExtensionConfigurationSettings;
}

export interface SystemToolSnapshotData {
  extensions: SystemExtensionSettingsItem[];
  tools: SystemToolSettingsItem[];
}
