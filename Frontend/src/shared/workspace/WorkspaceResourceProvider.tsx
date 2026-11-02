import {
  createContext,
  lazy,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { Button, Dialog, DialogContent, Sheet, SheetContent, Spinner } from "../ui";
import type { WorkspaceResourceLocator } from "./WorkspaceResourceLocator";
import type { WorkspacePreviewResource } from "./WorkspacePreviewResource";
import { readWorkspaceResourceBlob } from "../../api/workspaceResourceClient";
import { AgentDirectoryProvider } from "../../features/agents/AgentDirectoryProvider";
import {
  closeWorkspaceTab,
  createBlankWorkspaceTab,
  createInitialWorkspaceTabState,
  createWorkspaceTab,
  createPreviewWorkspaceTab,
  createWorkspaceTabId,
  navigateWorkspaceTab,
  openWorkspaceTabInTabs,
  reloadWorkspaceTab,
  stepWorkspaceTabHistory,
  syncWorkspaceTabPath,
  updateWorkspaceTabTitle,
  updateWorkspaceTabFavicon,
  type WorkspaceTab,
  type WorkspaceTabEntry,
} from "./WorkspaceTabs";

const LazyWorkspaceBrowserSurface = lazy(() =>
  import("./WorkspaceBrowserSurface").then((module) => ({ default: module.WorkspaceBrowserSurface })),
);

export interface WorkspaceResourceController {
  readonly httpBaseUrl: string;
  readonly csrfToken?: string;
  readonly tabs: readonly WorkspaceTab[];
  readonly activeTabId: string;
  readonly pendingCloseTabId?: string;
  readonly openResource: (locator: WorkspaceResourceLocator) => void;
  readonly openPreview: (resource: WorkspacePreviewResource) => void;
  readonly newBlankTab: () => void;
  readonly activateTab: (tabId: string) => void;
  readonly requestCloseTab: (tabId: string) => void;
  readonly closeTab: (tabId: string) => void;
  readonly cancelCloseTab: () => void;
  readonly navigateActiveTab: (entry: WorkspaceTabEntry) => void;
  readonly navigateTab: (tabId: string, entry: WorkspaceTabEntry) => void;
  readonly setTabTitle: (tabId: string, title: string) => void;
  readonly setTabFavicon: (tabId: string, pageUrl: string, favicon: string) => void;
  readonly goBack: () => void;
  readonly goForward: () => void;
  readonly reloadActiveTab: () => void;
  readonly syncTabPath: (tabId: string, path: string) => void;
  readonly setTabDirty: (tabId: string, dirty: boolean) => void;
  readonly dirty: boolean;
  readonly setDirty: (dirty: boolean) => void;
  readonly registerReferenceHandler: (handler: (file: File) => void) => () => void;
  readonly referenceResource: (path: string) => Promise<void>;
}

const WorkspaceResourceContext = createContext<WorkspaceResourceController | undefined>(undefined);

interface WorkspaceResourceProviderProps {
  readonly children: ReactNode;
  readonly csrfToken?: string;
  readonly httpBaseUrl: string;
  /** The persistent tool dock hosts the workspace browser when the layout exposes one. */
  readonly dockAvailable?: boolean;
  /** Lets the shell focus the workspace surface after a resource is opened. */
  readonly onOpenInDock?: () => void;
}

/** Application composition; standalone resource previews do not load Agent settings. */
export function WorkspaceRuntimeProvider(props: WorkspaceResourceProviderProps): JSX.Element {
  return (
    <AgentDirectoryProvider httpBaseUrl={props.httpBaseUrl} csrfToken={props.csrfToken}>
      <WorkspaceResourceProvider {...props} />
    </AgentDirectoryProvider>
  );
}

export function WorkspaceResourceProvider({
  children,
  csrfToken,
  httpBaseUrl,
  dockAvailable = false,
  onOpenInDock,
}: WorkspaceResourceProviderProps): JSX.Element {
  const tabSequence = useRef(1);
  const nextTabId = useCallback((): string => {
    tabSequence.current += 1;
    return createWorkspaceTabId(tabSequence.current);
  }, []);
  const [tabState, setTabState] = useState(() =>
    createInitialWorkspaceTabState(createWorkspaceTabId(tabSequence.current)),
  );
  const [dirtyTabIds, setDirtyTabIds] = useState<ReadonlySet<string>>(() => new Set());
  const [pendingCloseTabId, setPendingCloseTabId] = useState<string>();
  const [standaloneOpen, setStandaloneOpen] = useState(false);
  const referenceHandler = useRef<((file: File) => void) | undefined>(undefined);

  const activeTab = tabState.tabs.find((tab) => tab.id === tabState.activeTabId) ?? tabState.tabs[0];
  const activeTabId = activeTab?.id ?? "";

  const registerReferenceHandler = useCallback((handler: (file: File) => void) => {
    referenceHandler.current = handler;
    return () => {
      if (referenceHandler.current === handler) referenceHandler.current = undefined;
    };
  }, []);

  const referenceResource = useCallback(
    async (path: string) => {
      const handler = referenceHandler.current;
      if (!handler) throw new Error(frontendMessage("workspace.composerUnavailable"));
      const blob = await readWorkspaceResourceBlob(httpBaseUrl, path);
      if (referenceHandler.current !== handler) throw new Error(frontendMessage("workspace.composerUnavailable"));
      handler(new File([blob], path.split("/").at(-1)!, { type: blob.type }));
    },
    [httpBaseUrl],
  );

  const activateOpenedTab = useCallback((tab: WorkspaceTab): void => {
    setTabState((current) => {
      const next = openWorkspaceTabInTabs(current.tabs, current.activeTabId, tab);
      return { tabs: next.tabs, activeTabId: next.activeTabId };
    });
  }, []);

  const openResource = useCallback(
    (locator: WorkspaceResourceLocator): void => {
      activateOpenedTab(createWorkspaceTab(nextTabId(), locator));
      if (dockAvailable) onOpenInDock?.();
      else setStandaloneOpen(true);
    },
    [activateOpenedTab, dockAvailable, nextTabId, onOpenInDock],
  );

  const openPreview = useCallback(
    (resource: WorkspacePreviewResource): void => {
      activateOpenedTab(createPreviewWorkspaceTab(nextTabId(), resource));
      if (dockAvailable) onOpenInDock?.();
      else setStandaloneOpen(true);
    },
    [activateOpenedTab, dockAvailable, nextTabId, onOpenInDock],
  );

  const newBlankTab = useCallback((): void => {
    const tab = createBlankWorkspaceTab(nextTabId());
    setTabState((current) => ({ tabs: [...current.tabs, tab], activeTabId: tab.id }));
  }, [nextTabId]);

  const activateTab = useCallback((tabId: string): void => {
    setTabState((current) => {
      if (current.activeTabId === tabId || !current.tabs.some((tab) => tab.id === tabId)) return current;
      return { ...current, activeTabId: tabId };
    });
  }, []);

  const closeTab = useCallback(
    (tabId: string): void => {
      const replacement = createBlankWorkspaceTab(nextTabId());
      setTabState((current) => {
        const next = closeWorkspaceTab(current.tabs, current.activeTabId, tabId);
        if (next.tabs === current.tabs) return current;
        if (next.tabs.length === 0) return { tabs: [replacement], activeTabId: replacement.id };
        return next;
      });
      setDirtyTabIds((current) => {
        if (!current.has(tabId)) return current;
        const next = new Set(current);
        next.delete(tabId);
        return next;
      });
      setPendingCloseTabId((current) => (current === tabId ? undefined : current));
    },
    [nextTabId],
  );

  const requestCloseTab = useCallback(
    (tabId: string): void => {
      if (dirtyTabIds.has(tabId)) {
        setPendingCloseTabId(tabId);
        return;
      }
      closeTab(tabId);
    },
    [closeTab, dirtyTabIds],
  );

  const cancelCloseTab = useCallback((): void => setPendingCloseTabId(undefined), []);

  const navigateActiveTab = useCallback((entry: WorkspaceTabEntry): void => {
    setTabState((current) => ({
      ...current,
      tabs: current.tabs.map((tab) => (tab.id === current.activeTabId ? navigateWorkspaceTab(tab, entry) : tab)),
    }));
  }, []);

  const navigateTab = useCallback((tabId: string, entry: WorkspaceTabEntry): void => {
    setTabState((current) => ({
      ...current,
      tabs: current.tabs.map((tab) => (tab.id === tabId ? navigateWorkspaceTab(tab, entry) : tab)),
    }));
  }, []);

  const setTabTitle = useCallback((tabId: string, title: string): void => {
    setTabState((current) => ({
      ...current,
      tabs: current.tabs.map((tab) => (tab.id === tabId ? updateWorkspaceTabTitle(tab, title) : tab)),
    }));
  }, []);

  const setTabFavicon = useCallback((tabId: string, pageUrl: string, favicon: string): void => {
    setTabState((current) => {
      const tab = current.tabs.find((entry) => entry.id === tabId);
      if (!tab) return current;
      const updated = updateWorkspaceTabFavicon(tab, pageUrl, favicon);
      return updated === tab
        ? current
        : { ...current, tabs: current.tabs.map((entry) => (entry === tab ? updated : entry)) };
    });
  }, []);

  const stepActiveHistory = useCallback((delta: number): void => {
    setTabState((current) => ({
      ...current,
      tabs: current.tabs.map((tab) => (tab.id === current.activeTabId ? stepWorkspaceTabHistory(tab, delta) : tab)),
    }));
  }, []);

  const goBack = useCallback((): void => stepActiveHistory(-1), [stepActiveHistory]);
  const goForward = useCallback((): void => stepActiveHistory(1), [stepActiveHistory]);

  const reloadActiveTab = useCallback((): void => {
    setTabState((current) => ({
      ...current,
      tabs: current.tabs.map((tab) => (tab.id === current.activeTabId ? reloadWorkspaceTab(tab) : tab)),
    }));
  }, []);

  const syncTabPath = useCallback((tabId: string, path: string): void => {
    setTabState((current) => ({
      ...current,
      tabs: current.tabs.map((tab) => (tab.id === tabId ? syncWorkspaceTabPath(tab, path) : tab)),
    }));
  }, []);

  const setTabDirty = useCallback((tabId: string, dirty: boolean): void => {
    setDirtyTabIds((current) => {
      if (current.has(tabId) === dirty) return current;
      const next = new Set(current);
      if (dirty) next.add(tabId);
      else next.delete(tabId);
      return next;
    });
  }, []);

  const setDirty = useCallback(
    (dirty: boolean): void => {
      if (activeTabId) setTabDirty(activeTabId, dirty);
    },
    [activeTabId, setTabDirty],
  );

  const controller = useMemo(
    () => ({
      httpBaseUrl,
      csrfToken,
      tabs: tabState.tabs,
      activeTabId,
      pendingCloseTabId,
      openResource,
      openPreview,
      newBlankTab,
      activateTab,
      requestCloseTab,
      closeTab,
      cancelCloseTab,
      navigateActiveTab,
      navigateTab,
      setTabTitle,
      setTabFavicon,
      goBack,
      goForward,
      reloadActiveTab,
      syncTabPath,
      setTabDirty,
      dirty: dirtyTabIds.has(activeTabId),
      setDirty,
      referenceResource,
      registerReferenceHandler,
    }),
    [
      csrfToken,
      httpBaseUrl,
      tabState.tabs,
      activeTabId,
      pendingCloseTabId,
      openResource,
      openPreview,
      newBlankTab,
      activateTab,
      requestCloseTab,
      closeTab,
      cancelCloseTab,
      navigateActiveTab,
      navigateTab,
      setTabTitle,
      setTabFavicon,
      goBack,
      goForward,
      reloadActiveTab,
      syncTabPath,
      setTabDirty,
      dirtyTabIds,
      setDirty,
      referenceResource,
      registerReferenceHandler,
    ],
  );

  useEffect(() => {
    if (!dockAvailable || !standaloneOpen) return;
    setStandaloneOpen(false);
    onOpenInDock?.();
  }, [dockAvailable, standaloneOpen, onOpenInDock]);
  const pendingCloseTab = tabState.tabs.find((tab) => tab.id === pendingCloseTabId);

  return (
    <WorkspaceResourceContext.Provider value={controller}>
      {children}
      {!dockAvailable ? (
        <Sheet open={standaloneOpen} onOpenChange={setStandaloneOpen}>
          <SheetContent
            side="right"
            title={frontendMessage("resource.workspace")}
            className="w-[min(560px,calc(100vw-24px))] p-0"
            deferContentMount
          >
            <div className="min-h-0 flex-1">
              <Suspense fallback={<WorkspaceBrowserLoading />}>
                <LazyWorkspaceBrowserSurface controller={controller} />
              </Suspense>
            </div>
          </SheetContent>
        </Sheet>
      ) : null}
      {pendingCloseTab ? (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) cancelCloseTab();
          }}
        >
          <DialogContent
            title={frontendMessage("workspace.browser.unsavedTitle")}
            description={frontendMessage("workspace.browser.unsavedDescription")}
            showClose={false}
            footer={
              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={cancelCloseTab}>
                  {frontendMessage("resource.keepEditing")}
                </Button>
                <Button variant="destructive" size="sm" onClick={() => closeTab(pendingCloseTab.id)}>
                  {frontendMessage("resource.discard")}
                </Button>
              </div>
            }
          />
        </Dialog>
      ) : null}
    </WorkspaceResourceContext.Provider>
  );
}

export function useWorkspaceResourceController(): WorkspaceResourceController | undefined {
  return useContext(WorkspaceResourceContext);
}

/** Renders the tabbed workspace browser inside the persistent tool dock. */
export function WorkspaceBrowserSurface(): JSX.Element {
  const controller = useWorkspaceResourceController();
  if (!controller) return <WorkspaceBrowserLoading />;

  return (
    <Suspense fallback={<WorkspaceBrowserLoading />}>
      <LazyWorkspaceBrowserSurface controller={controller} />
    </Suspense>
  );
}

function WorkspaceBrowserLoading(): JSX.Element {
  return (
    <div className="grid h-full place-items-center" aria-busy="true" data-workspace-dock-loading>
      <Spinner size="sm" className="text-content-secondary" />
    </div>
  );
}
