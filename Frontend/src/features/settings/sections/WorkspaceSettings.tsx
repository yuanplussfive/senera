import type { WorkspaceControllerHandle } from "../../../app/useWorkspaceController";
import { frontendMessage } from "../../../i18n/frontendMessageCatalog";
import { AppIcon, Button, StateView, useClipboardCopy } from "../../../shared/ui";
import { SettingsPanel } from "../SettingsPanel";
import type { SettingsEnvironment } from "../SettingsWorkbenchContracts";

export function WorkspaceSettings({
  workspace,
}: {
  workspace: WorkspaceControllerHandle;
  environment: SettingsEnvironment;
}): JSX.Element {
  const clipboard = useClipboardCopy();
  return (
    <SettingsPanel
      title={frontendMessage("settings.workspace.currentTitle")}
      description={frontendMessage("settings.workspace.currentDescription")}
    >
      {workspace.snapshot ? (
        <div className="space-y-3">
          {[
            { label: frontendMessage("settings.workspace.rootLabel"), path: workspace.snapshot.workspaceRoot },
            { label: frontendMessage("settings.workspace.configLabel"), path: workspace.snapshot.configPath },
          ].map((row) => (
            <div key={row.label} className="flex min-w-0 items-center gap-3">
              <span className="shrink-0 text-xs text-content-muted">{row.label}</span>
              <span className="min-w-0 flex-1 truncate text-xs" title={row.path}>
                {row.path}
              </span>
              <Button size="sm" variant="ghost" onClick={() => void clipboard.copyText(row.path)}>
                <AppIcon icon="copy" size={14} />
                {frontendMessage("code.copy")}
              </Button>
            </div>
          ))}
        </div>
      ) : (
        <StateView
          status={workspace.unavailable ? "error" : "loading"}
          description={workspace.unavailable ?? frontendMessage("settings.workspace.loading")}
        />
      )}
      <Button size="sm" variant="ghost" className="mt-3" onClick={workspace.refresh}>
        <AppIcon icon="refresh" size={14} />
        {frontendMessage("settings.workspace.refresh")}
      </Button>
    </SettingsPanel>
  );
}
