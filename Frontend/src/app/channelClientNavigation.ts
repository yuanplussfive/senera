import { readDesktopBridge } from "./desktopBridge";
import { readMobileBridge } from "./mobileBridge";

/** The client owns its document and connection; opening it never navigates the console. */
export async function openOneBot11Client(source: string, workspaceId: string): Promise<{ ok: boolean }> {
  const mobile = readMobileBridge();
  if (mobile?.openWebClient) return mobile.openWebClient(source);
  const bridge = readDesktopBridge();
  if (bridge?.isDesktop) {
    if (!bridge.openQqClient) return { ok: false };
    return bridge.openQqClient(workspaceId);
  }
  window.open(source, "_blank", "noopener,noreferrer");
  return { ok: true };
}
