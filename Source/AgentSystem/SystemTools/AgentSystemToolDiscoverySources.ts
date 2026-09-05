import type { AgentToolDiscoverySource } from "../Types/AgentToolContractTypes.js";

export const AgentSystemToolDiscoverySources = {
  Web: {
    Id: "web",
    Title: "Web",
    Description: "Public internet information, online services, and current external data.",
  },
  Browser: {
    Id: "browser",
    Title: "Browser",
    Description: "Controlled browser sessions for interactive public web pages.",
  },
  Desktop: {
    Id: "desktop",
    Title: "Desktop",
    Description: "The local desktop screen and input devices controlled by the host.",
  },
  Uploads: {
    Id: "uploads",
    Title: "Uploads",
    Description: "Files and media explicitly uploaded by the user.",
  },
} as const satisfies Record<string, AgentToolDiscoverySource>;
