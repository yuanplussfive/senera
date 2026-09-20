import { useEffect, useState } from "react";
import { AlertTriangle, Check, Copy, FolderOpen, FolderSearch, RefreshCw, X } from "lucide-react";
import { readDesktopBridge } from "../../../app/desktopBridge";
import type { WorkspaceControllerHandle } from "../../../app/useWorkspaceController";
import { frontendMessage } from "../../../i18n/frontendMessageCatalog";
import { cn } from "../../../lib/util";
import { MotionIconSwap } from "../../../shared/motion";
import {
  Button,
  Dialog,
  DialogActionButton,
  DialogActions,
  DialogContent,
  IconButton,
  Input,
  Spinner,
  StateView,
  Tooltip,
  useClipboardCopy,
} from "../../../shared/ui";
import { SettingsPanel } from "../SettingsPanel";
import type { SettingsEnvironment } from "../SettingsWorkbenchContracts";

export function WorkspaceSettings({
  workspace,
  environment,
}: {
  workspace: WorkspaceControllerHandle;
  environment: SettingsEnvironment;
}): JSX.Element {
  const isDesktop = environment.surface === "desktop";
  const bridge = readDesktopBridge();
  const { snapshot, phase, error, unavailable, refresh, switchWorkspace, resetError } = workspace;
  const [path, setPath] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);

  const currentRoot = snapshot?.workspaceRoot ?? null;
  const normalizedPath = path.trim();
  const sameRoot =
    currentRoot !== null && normalizedPath.length > 0 && isSameWorkspacePath(normalizedPath, currentRoot);
  const switching = phase === "switching";
  const canSwitch = !switching && !unavailable && normalizedPath.length > 0 && !sameRoot;

  useEffect(() => {
    if (phase !== "succeeded") return;
    setPath("");
  }, [phase]);

  const handleBrowse = async (): Promise<void> => {
    const selected = await bridge?.chooseWorkspaceFolder?.();
    if (selected) setPath(selected);
  };

  const requestSwitch = (): void => {
    if (!canSwitch || normalizedPath.length === 0) return;
    setConfirmOpen(true);
  };

  const confirmSwitch = (): void => {
    setConfirmOpen(false);
    switchWorkspace(normalizedPath);
  };

  return (
    <div className="space-y-5">
      <SettingsPanel
        title={frontendMessage("settings.workspace.currentTitle")}
        description={frontendMessage("settings.workspace.currentDescription")}
      >
        {snapshot ? (
          <div className="divide-y divide-line-subtle">
            <WorkspacePathRow
              label={frontendMessage("settings.workspace.rootLabel")}
              value={snapshot.workspaceRoot}
              icon={<FolderOpen aria-hidden="true" className="h-3.5 w-3.5" />}
            />
            <WorkspacePathRow
              label={frontendMessage("settings.workspace.configLabel")}
              value={snapshot.configPath}
              icon={<FolderSearch aria-hidden="true" className="h-3.5 w-3.5" />}
            />
          </div>
        ) : unavailable ? (
          <WorkspaceStateMessage tone="warn" text={unavailable} />
        ) : (
          <StateView
            status="loading"
            className="min-h-[96px] bg-surface-subtle"
            description={frontendMessage("settings.workspace.loading")}
          />
        )}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {isDesktop ? (
            <span className="text-[11.5px] leading-5 text-content-muted">
              {frontendMessage("settings.workspace.desktopHint")}
            </span>
          ) : null}
          <Button size="sm" variant="outline" className="ml-auto" onClick={refresh}>
            <RefreshCw aria-hidden="true" className="h-3.5 w-3.5" />
            {frontendMessage("settings.workspace.refresh")}
          </Button>
        </div>
      </SettingsPanel>

      <SettingsPanel
        title={frontendMessage("settings.workspace.switchTitle")}
        description={frontendMessage("settings.workspace.switchDescription")}
      >
        <div className="space-y-3">
          <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
            <Input
              value={path}
              onChange={(event) => setPath(event.target.value)}
              placeholder={frontendMessage("settings.workspace.pathPlaceholder")}
              aria-label={frontendMessage("settings.workspace.pathLabel")}
              disabled={switching}
              spellCheck={false}
              className="font-mono text-[13px]"
              onKeyDown={(event) => {
                if (event.key === "Enter" && canSwitch) requestSwitch();
              }}
            />
            {isDesktop && bridge?.chooseWorkspaceFolder ? (
              <Button variant="outline" disabled={switching} onClick={() => void handleBrowse()}>
                <FolderOpen aria-hidden="true" className="h-3.5 w-3.5" />
                {frontendMessage("settings.workspace.browse")}
              </Button>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant={switching ? "outline" : "default"}
              loading={switching}
              disabled={!canSwitch}
              onClick={requestSwitch}
            >
              {switching ? null : (
                <>
                  <FolderSearch aria-hidden="true" className="h-3.5 w-3.5" />
                  {frontendMessage("settings.workspace.switch")}
                </>
              )}
            </Button>
            {sameRoot ? (
              <span className="text-[11.5px] leading-5 text-content-muted">
                {frontendMessage("settings.workspace.sameRoot")}
              </span>
            ) : null}
          </div>
          {switching ? (
            <div className="flex items-center gap-2 text-[12px] leading-5 text-accent-content" aria-live="polite">
              <Spinner size="xs" />
              <span>{frontendMessage("settings.workspace.switchInProgress")}</span>
            </div>
          ) : null}
          {phase === "succeeded" ? (
            <div
              className="flex items-center gap-2 rounded-lg border border-moss-500/25 bg-moss-500/10 px-3 py-2 text-[12px] leading-5 text-moss-700"
              aria-live="polite"
              data-workspace-switch-outcome="succeeded"
            >
              <Check aria-hidden="true" className="h-3.5 w-3.5" />
              <span>{frontendMessage("settings.workspace.switchSucceeded")}</span>
            </div>
          ) : null}
          {phase === "failed" && error ? (
            <div
              className="flex flex-wrap items-center gap-2 rounded-lg border border-brick-500/25 bg-brick-500/10 px-3 py-2 text-[12px] leading-5 text-brick-700"
              role="alert"
              data-workspace-switch-outcome="failed"
            >
              <AlertTriangle aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
              <span className="min-w-0 flex-1">{error.message}</span>
              <Button size="sm" variant="outline" onClick={resetError}>
                <X aria-hidden="true" className="h-3.5 w-3.5" />
                {frontendMessage("settings.workspace.dismiss")}
              </Button>
            </div>
          ) : null}
          {unavailable && !snapshot ? <WorkspaceStateMessage tone="warn" text={unavailable} /> : null}
        </div>
      </SettingsPanel>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent
          title={frontendMessage("settings.workspace.confirmTitle")}
          description={frontendMessage("settings.workspace.confirmDescription")}
          showClose={false}
          className="w-[min(500px,calc(100vw_-_32px))]"
          bodyClassName="px-8 pb-7 pt-1"
          footerClassName="px-8"
          footer={
            <DialogActions>
              <DialogActionButton close autoFocus>
                {frontendMessage("settings.workspace.cancel")}
              </DialogActionButton>
              <DialogActionButton variant="danger" onClick={confirmSwitch}>
                <FolderSearch aria-hidden="true" className="h-3.5 w-3.5" />
                {frontendMessage("settings.workspace.confirmSwitch")}
              </DialogActionButton>
            </DialogActions>
          }
        >
          <div className="flex items-start gap-2.5 py-1 text-[12.5px] leading-5 text-ink-600">
            <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-brick-50 text-brick-600">
              <AlertTriangle aria-hidden="true" className="h-3.5 w-3.5" />
            </span>
            <span>{frontendMessage("settings.workspace.sessionWarning")}</span>
          </div>
          <div className="mt-4 min-w-0 rounded-lg border border-line bg-surface-subtle px-3 py-2.5">
            <div className="font-mono text-[12px] leading-5 break-all text-content-primary">{normalizedPath}</div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function WorkspacePathRow({ label, value, icon }: { label: string; value: string; icon: JSX.Element }): JSX.Element {
  const { copied, copyText } = useClipboardCopy({ successMessage: frontendMessage("settings.action.copied") });
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-3 first:pt-0 last:pb-0">
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 text-[11.5px] text-content-muted">
          {icon}
          <span>{label}</span>
        </div>
        <code
          className="mt-1 block truncate font-mono text-[12px] leading-5 text-content-primary"
          title={value}
          data-workspace-path={label}
        >
          {value}
        </code>
      </div>
      <Tooltip content={copied ? frontendMessage("settings.action.copied") : frontendMessage("settings.action.copy")}>
        <span className="inline-flex">
          <IconButton
            label={frontendMessage("settings.action.copy")}
            size="sm"
            tone="muted"
            onClick={() => void copyText(value)}
          >
            <MotionIconSwap stateKey={copied ? "copied" : "copy"}>
              {copied ? (
                <Check aria-hidden="true" className="h-3.5 w-3.5 text-accent-content" />
              ) : (
                <Copy aria-hidden="true" className="h-3.5 w-3.5" />
              )}
            </MotionIconSwap>
          </IconButton>
        </span>
      </Tooltip>
    </div>
  );
}

function WorkspaceStateMessage({ tone, text }: { tone: "warn"; text: string }): JSX.Element {
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-lg border px-3 py-2.5 text-[12px] leading-5",
        tone === "warn" && "border-brick-200 bg-brick-50 text-brick-700",
      )}
      role="status"
    >
      <AlertTriangle aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
      <span>{text}</span>
    </div>
  );
}

function isSameWorkspacePath(left: string, right: string): boolean {
  const caseInsensitive = typeof navigator !== "undefined" && /win32|windows/i.test(navigator.platform ?? "");
  const normalize = (value: string): string => {
    const trimmed = value.trim().replace(/[\\/]+$/, "");
    return caseInsensitive ? trimmed.toLocaleLowerCase() : trimmed;
  };
  return normalize(left) === normalize(right);
}
