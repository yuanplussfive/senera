import type { AgentToolDiscoverySource } from "../Types/AgentToolContractTypes.js";

export const AgentSystemToolDiscoverySources = {
  Web: {
    Id: "web",
    Title: "Web",
    Description: "Public internet information, online services, and current external data.",
  },
  Uploads: {
    Id: "uploads",
    Title: "Uploads",
    Description: "Files and media explicitly uploaded by the user.",
  },
} as const satisfies Record<string, AgentToolDiscoverySource>;
