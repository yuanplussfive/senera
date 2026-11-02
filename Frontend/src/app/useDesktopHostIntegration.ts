import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { frontendChatMessage } from "../i18n/frontendChatMessageCatalog";
import {
  loadDesktopHostIntegrationCapabilities,
  readCachedDesktopHostIntegrationCapabilities,
  readDesktopBridge,
  type DesktopHostIntegrationCapabilities,
  type DesktopHostIntegrationResult,
} from "./desktopBridge";

export interface DesktopHostIntegrationController {
  readonly capabilities?: DesktopHostIntegrationCapabilities;
  readonly revealWorkspace: () => Promise<void>;
  readonly openExternalTerminal: () => Promise<void>;
}

export function useDesktopHostIntegration(): DesktopHostIntegrationController {
  const [capabilities, setCapabilities] = useState<DesktopHostIntegrationCapabilities | undefined>(
    readCachedDesktopHostIntegrationCapabilities,
  );

  useEffect(() => {
    let active = true;
    void loadDesktopHostIntegrationCapabilities().then((value) => {
      if (active) setCapabilities(value);
    });
    return () => {
      active = false;
    };
  }, []);

  const revealWorkspace = useCallback(async (): Promise<void> => {
    await runDesktopHostAction(readDesktopBridge()?.revealWorkspace);
  }, []);
  const openExternalTerminal = useCallback(async (): Promise<void> => {
    await runDesktopHostAction(readDesktopBridge()?.openExternalTerminal);
  }, []);

  return { capabilities, revealWorkspace, openExternalTerminal };
}

async function runDesktopHostAction(action?: () => Promise<DesktopHostIntegrationResult>): Promise<void> {
  if (!action) return;
  try {
    const result = await action();
    if (!result.ok) toast.error(frontendChatMessage("chat.composer.host.failed"));
  } catch {
    toast.error(frontendChatMessage("chat.composer.host.failed"));
  }
}
