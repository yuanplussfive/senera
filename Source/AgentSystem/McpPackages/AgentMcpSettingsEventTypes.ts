import { AgentEventKinds } from "../Events/AgentEventCatalog.js";
import type { AgentMcpServerSettingsItem, AgentSystemToolSettingsItem } from "./AgentMcpManagementService.js";
import type { AgentSystemExtensionSettingsItem } from "../SystemTools/AgentSystemToolSource.js";
import type { AgentActivationCatalogSnapshot } from "../Activation/AgentActivationTypes.js";

export type AgentMcpSettingsDomainEvent =
  | {
      readonly kind: typeof AgentEventKinds.SystemToolSnapshot;
      readonly context: Record<string, never>;
      readonly data: {
        readonly extensions: readonly AgentSystemExtensionSettingsItem[];
        readonly tools: readonly AgentSystemToolSettingsItem[];
        readonly activation: AgentActivationCatalogSnapshot;
      };
    }
  | {
      readonly kind: typeof AgentEventKinds.McpServerSnapshot;
      readonly context: Record<string, never>;
      readonly data: {
        readonly servers: readonly AgentMcpServerSettingsItem[];
        /** The same live @ activation catalog used by the system-tool snapshot. */
        readonly activation: AgentActivationCatalogSnapshot;
        readonly operation?: { readonly requestId: string; readonly kind: "mcp_input_update" };
      };
    };
