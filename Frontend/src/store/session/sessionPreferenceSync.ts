import { PERSIST_KEY, readPersistedSessionPreferences, type PersistedSessionState } from "./persistence";

interface SessionPreferenceSyncPort {
  readonly read: () => PersistedSessionState;
  readonly update: (
    state: PersistedSessionState & { sidebarCollapsed?: boolean; rightPanelCollapsed?: boolean },
  ) => void;
}

/** Cross-window synchronization only publishes application preferences. */
export function installSessionPreferenceSynchronization(port: SessionPreferenceSyncPort): void {
  if (typeof window === "undefined") return;
  window.addEventListener("storage", (event) => {
    if (event.key !== PERSIST_KEY) return;
    const preferences = readPersistedSessionPreferences(event.newValue);
    if (!preferences) return;
    const current = port.read();
    const changes = Object.fromEntries(
      Object.entries(preferences).filter(
        ([key, value]) =>
          value !== undefined && JSON.stringify(value) !== JSON.stringify(current[key as keyof PersistedSessionState]),
      ),
    );
    if (!Object.keys(changes).length) return;
    port.update({
      ...changes,
      ...(changes.defaultSidebarCollapsed !== undefined
        ? { sidebarCollapsed: preferences.defaultSidebarCollapsed }
        : {}),
      ...(changes.defaultRightPanelCollapsed !== undefined
        ? { rightPanelCollapsed: preferences.defaultRightPanelCollapsed }
        : {}),
    });
  });
}
