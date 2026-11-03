import {
  AppIcon,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  ScrollArea,
} from "../../shared/ui";
import { useStore } from "../../store/sessionStore";
import { readConversationAgent, selectConversationAgent } from "../../store/session/sessionAgentSelection";
import { frontendFeatureMessage as t } from "../../i18n/frontendFeatureMessageCatalog";
import { useAgentDirectory } from "./AgentDirectoryProvider";

export function AgentMenu({ disabled, onManage }: { disabled: boolean; onManage: () => void }): JSX.Element {
  const { directory, controller } = useAgentDirectory();
  const agent = useStore(readConversationAgent);
  return (
    <>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger disabled={disabled || !directory} icon={<AppIcon icon="user" size={16} />}>
          <span className="flex min-w-0 items-center justify-between gap-4">
            <span className="shrink-0">{t("agents.select")}</span>
            <span className="truncate text-xs text-content-muted">{agent?.name}</span>
          </span>
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent className="w-60" aria-label={t("agents.select")}>
          <ScrollArea viewportClassName="max-h-64">
            <DropdownMenuRadioGroup
              value={agent?.id ?? ""}
              onValueChange={(id) => useStore.setState((state) => selectConversationAgent(state, id))}
            >
              {directory?.agents
                .filter((entry) => entry.enabled && !directory.deletingAgentIds.includes(entry.id))
                .map((entry) => (
                  <DropdownMenuRadioItem key={entry.id} value={entry.id}>
                    {entry.name}
                  </DropdownMenuRadioItem>
                ))}
            </DropdownMenuRadioGroup>
          </ScrollArea>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={disabled || !directory}
            icon={<AppIcon icon="users" size={16} />}
            onSelect={onManage}
          >
            {t("agents.manage")}
          </DropdownMenuItem>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      {controller?.error ? (
        <p role="alert" className="px-2 py-1 text-xs text-brick-600">
          {controller.error}
        </p>
      ) : null}
    </>
  );
}
