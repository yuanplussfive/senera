import {
  createContext,
  lazy,
  Suspense,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { Spinner } from "../ui";
import { useInertSiblings } from "../ui/useInertSiblings";
import type { WorkspaceResourceLocator } from "./WorkspaceResourceLocator";
import { readWorkspaceResourceBlob } from "../../api/workspaceResourceClient";

const LazyWorkspaceResourceWorkbench = lazy(() =>
  import("./WorkspaceResourceWorkbench").then((module) => ({ default: module.WorkspaceResourceWorkbench })),
);

export interface WorkspaceResourceController {
  readonly httpBaseUrl: string;
  readonly csrfToken?: string;
  readonly openResource: (locator: WorkspaceResourceLocator) => void;
  readonly dirty: boolean;
  readonly setDirty: (dirty: boolean) => void;
  readonly registerReferenceHandler: (handler: (file: File) => void) => () => void;
  readonly referenceResource: (path: string) => Promise<void>;
}

const WorkspaceResourceContext = createContext<WorkspaceResourceController | undefined>(undefined);

export function WorkspaceResourceProvider({
  children,
  csrfToken,
  httpBaseUrl,
}: {
  readonly children: ReactNode;
  readonly csrfToken?: string;
  readonly httpBaseUrl: string;
}): JSX.Element {
  const [activeLocator, setActiveLocator] = useState<WorkspaceResourceLocator>();
  const [dirty, setDirty] = useState(false);
  const referenceHandler = useRef<((file: File) => void) | undefined>(undefined);
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
  const openResource = useCallback((locator: WorkspaceResourceLocator): void => setActiveLocator(locator), []);
  const controller = useMemo(
    () => ({ httpBaseUrl, csrfToken, openResource, dirty, setDirty, referenceResource, registerReferenceHandler }),
    [csrfToken, httpBaseUrl, openResource, dirty, referenceResource, registerReferenceHandler],
  );

  return (
    <WorkspaceResourceContext.Provider value={controller}>
      {children}
      {activeLocator ? (
        <Suspense fallback={<WorkspaceResourceLoadingFallback />}>
          <LazyWorkspaceResourceWorkbench
            controller={controller}
            locator={activeLocator}
            open
            onOpenChange={(open) => {
              if (!open) setActiveLocator(undefined);
            }}
          />
        </Suspense>
      ) : null}
    </WorkspaceResourceContext.Provider>
  );
}

export function useWorkspaceResourceController(): WorkspaceResourceController | undefined {
  return useContext(WorkspaceResourceContext);
}

function WorkspaceResourceLoadingFallback(): JSX.Element {
  const overlayRef = useRef<HTMLDivElement>(null);
  useInertSiblings(overlayRef);

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-[60] grid place-items-center bg-[var(--theme-dialog-backdrop)]"
      role="dialog"
      aria-modal="true"
      aria-busy="true"
      aria-label={frontendMessage("ui.loading")}
      tabIndex={-1}
      data-workspace-resource-loading
    >
      <Spinner size="sm" className="text-content-secondary" />
    </div>
  );
}
