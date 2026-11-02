import { frontendChatMessage } from "../../i18n/frontendChatMessageCatalog";
import { useDesktopHostIntegration } from "../../app/useDesktopHostIntegration";
import {
  AppIcon,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "../../shared/ui";

export function DesktopHostMenuItems(): JSX.Element | null {
  const host = useDesktopHostIntegration();
  const capabilities = host.capabilities;
  if (!capabilities?.revealWorkspace && !capabilities?.externalTerminal) return null;
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger icon={<AppIcon icon="external-link" size={16} />}>
        {frontendChatMessage("chat.composer.host.openWorkspace")}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        {capabilities.revealWorkspace ? (
          <DropdownMenuItem icon={<AppIcon icon="folder" size={16} />} onSelect={() => void host.revealWorkspace()}>
            {frontendChatMessage("chat.composer.host.revealWorkspace")}
          </DropdownMenuItem>
        ) : null}
        {capabilities.externalTerminal ? (
          <DropdownMenuItem
            icon={<AppIcon icon="terminal" size={16} />}
            onSelect={() => void host.openExternalTerminal()}
          >
            {frontendChatMessage("chat.composer.host.openTerminal")}
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}
