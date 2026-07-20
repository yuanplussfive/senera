import { useCallback, useEffect, useRef, useState } from "react";
import { readDesktopBridge } from "./desktopBridge";
import {
  buildWebSettingsLocation,
  createSettingsHistoryState,
  isSettingsHistoryState,
  readWebSettingsSection,
} from "./appSurface";
import { defaultSettingsSectionId, type SettingsSectionId } from "../features/settings/types";

export interface WebSettingsController {
  section: SettingsSectionId | null;
  closeConfirmationOpen: boolean;
  changeSection: (section: SettingsSectionId) => void;
  confirmClose: () => void;
  cancelClose: () => void;
  openSettings: (section?: SettingsSectionId, returnFocus?: HTMLElement | null) => Promise<void>;
  requestClose: () => void;
  setPendingChanges: (pending: boolean) => void;
  returnFocusRef: React.MutableRefObject<HTMLElement | null>;
}

export function useWebSettingsController(): WebSettingsController {
  const [section, setSection] = useState<SettingsSectionId | null>(() => readWebSettingsSection(window.location));
  const [pendingChanges, setPendingChangesState] = useState(false);
  const [closeConfirmationOpen, setCloseConfirmationOpen] = useState(false);
  const sectionRef = useRef(section);
  const pendingChangesRef = useRef(pendingChanges);
  const pendingCloseActionRef = useRef<(() => void) | null>(null);
  const bypassPopRef = useRef(false);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    sectionRef.current = section;
  }, [section]);
  useEffect(() => {
    pendingChangesRef.current = pendingChanges;
  }, [pendingChanges]);

  useEffect(() => {
    const initial = readWebSettingsSection(window.location);
    const search = new URLSearchParams(window.location.search);
    if (initial && !search.has("settings")) {
      window.history.replaceState(window.history.state, "", buildWebSettingsLocation(window.location, initial));
      setSection(initial);
    }
  }, []);

  const closeWithoutGuard = useCallback((): void => {
    if (isSettingsHistoryState(window.history.state)) {
      bypassPopRef.current = true;
      window.history.back();
      return;
    }
    window.history.replaceState(window.history.state, "", buildWebSettingsLocation(window.location, null));
    setSection(null);
  }, []);

  const requestClose = useCallback((): void => {
    if (!sectionRef.current) return;
    if (pendingChangesRef.current) {
      pendingCloseActionRef.current = closeWithoutGuard;
      setCloseConfirmationOpen(true);
      return;
    }
    closeWithoutGuard();
  }, [closeWithoutGuard]);

  useEffect(() => {
    const onPopState = (): void => {
      const nextSection = readWebSettingsSection(window.location);
      if (bypassPopRef.current) {
        bypassPopRef.current = false;
        setSection(nextSection);
        return;
      }
      if (sectionRef.current && !nextSection && pendingChangesRef.current) {
        const currentSection = sectionRef.current;
        window.history.pushState(
          createSettingsHistoryState(window.history.state),
          "",
          buildWebSettingsLocation(window.location, currentSection),
        );
        pendingCloseActionRef.current = closeWithoutGuard;
        setCloseConfirmationOpen(true);
        return;
      }
      setSection(nextSection);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [closeWithoutGuard]);

  useEffect(() => {
    if (!section || !pendingChanges) return;
    const onBeforeUnload = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [pendingChanges, section]);

  const openSettings = useCallback(
    async (target = defaultSettingsSectionId, returnFocus?: HTMLElement | null): Promise<void> => {
      const bridge = readDesktopBridge();
      if (bridge?.isDesktop) {
        await bridge.openSettings({ section: target });
        return;
      }
      returnFocusRef.current =
        returnFocus ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
      const current = sectionRef.current;
      const nextLocation = buildWebSettingsLocation(window.location, target);
      if (current) {
        window.history.replaceState(window.history.state, "", nextLocation);
      } else {
        window.history.pushState(createSettingsHistoryState(window.history.state), "", nextLocation);
      }
      setSection(target);
    },
    [],
  );

  const changeSection = useCallback((target: SettingsSectionId): void => {
    window.history.replaceState(window.history.state, "", buildWebSettingsLocation(window.location, target));
    setSection(target);
  }, []);

  return {
    section,
    closeConfirmationOpen,
    changeSection,
    confirmClose: () => {
      const action = pendingCloseActionRef.current;
      pendingCloseActionRef.current = null;
      setCloseConfirmationOpen(false);
      setPendingChangesState(false);
      action?.();
    },
    cancelClose: () => {
      pendingCloseActionRef.current = null;
      setCloseConfirmationOpen(false);
    },
    openSettings,
    requestClose,
    setPendingChanges: setPendingChangesState,
    returnFocusRef,
  };
}
