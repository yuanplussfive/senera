import type { CapacitorConfig } from "@capacitor/cli";
import {
  AgentDeviceCookieName,
  AgentLanDeviceCookieName,
  AgentMobileOrigin,
  AgentDeviceRequestTimeoutSeconds,
  AgentDeviceResponseMaxBytes,
} from "../Source/AgentSystem/Auth/AgentDeviceAuthenticationContract";

const origin = new URL(AgentMobileOrigin);
const config: CapacitorConfig = {
  appId: "ai.senera.mobile",
  appName: "Senera",
  webDir: ".cache/mobile-web",
  includePlugins: [
    "@aparajita/capacitor-secure-storage",
    "@capacitor/app",
    "@capacitor/barcode-scanner",
    "@capacitor/preferences",
  ],
  android: { path: "../Apps/Mobile/android", allowMixedContent: false, loggingBehavior: "debug" },
  server: { hostname: origin.hostname, androidScheme: "https", appStartPath: "/mobile/index.html" },
  plugins: {
    SeneraDeviceSession: {
      cookieName: AgentDeviceCookieName,
      lanCookieName: AgentLanDeviceCookieName,
      requestTimeoutSeconds: AgentDeviceRequestTimeoutSeconds,
      responseMaxBytes: AgentDeviceResponseMaxBytes,
    },
    SystemBars: { insetsHandling: "css", initialViewportFitValueHint: "cover" },
  },
};
export default config;
