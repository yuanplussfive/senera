import { AgentEventKinds } from "../Events/AgentEventCatalog.js";
import type { AgentMcpServerSettingsItem, AgentSystemToolSettingsItem } from "./AgentMcpManagementService.js";
import type { AgentSystemExtensionSettingsItem } from "../SystemTools/AgentSystemToolSource.js";

export type AgentMcpSettingsDomainEvent =
  | {
      readonly kind: typeof AgentEventKinds.SystemToolSnapshot;
      readonly context: Record<string, never>;
      readonly data: {
        readonly extensions: readonly AgentSystemExtensionSettingsItem[];
        readonly tools: readonly AgentSystemToolSettingsItem[];
      };
    }
  | {
      readonly kind: typeof AgentEventKinds.McpServerSnapshot;
      readonly context: Record<string, never>;
      readonly data: {
        readonly servers: readonly AgentMcpServerSettingsItem[];
        readonly operation?: { readonly requestId: string; readonly kind: "mcp_input_update" };
      };
    };
