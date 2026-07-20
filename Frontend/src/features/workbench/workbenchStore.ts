import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { readPersistedWindowGeometry, type WorkbenchWindowGeometry } from "./windowGeometry";

export type WorkbenchWindowId = "terminal";

interface WorkbenchStoreState {
  windowPlacements: Partial<Record<WorkbenchWindowId, WorkbenchWindowGeometry>>;
  setWindowPlacement: (id: WorkbenchWindowId, geometry: WorkbenchWindowGeometry) => void;
}

const WorkbenchPersistKey = "senera-workbench@v1";

export const useWorkbenchStore = create<WorkbenchStoreState>()(
  persist(
    (set) => ({
      windowPlacements: {},
      setWindowPlacement: (id, geometry) =>
        set((state) => ({ windowPlacements: { ...state.windowPlacements, [id]: geometry } })),
    }),
    {
      name: WorkbenchPersistKey,
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ windowPlacements: state.windowPlacements }),
      merge: (persisted, current) => ({
        ...current,
        windowPlacements: readPersistedWindowPlacements(persisted),
      }),
    },
  ),
);

function readPersistedWindowPlacements(value: unknown): WorkbenchStoreState["windowPlacements"] {
  if (!value || typeof value !== "object") return {};
  const placements = (value as { windowPlacements?: unknown }).windowPlacements;
  if (!placements || typeof placements !== "object" || Array.isArray(placements)) return {};
  const terminal = readPersistedWindowGeometry((placements as Record<string, unknown>).terminal);
  return terminal ? { terminal } : {};
}
