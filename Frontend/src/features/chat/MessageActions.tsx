import { Check, Copy, GitBranch, MoreHorizontal, RotateCcw, Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { cn } from "../../lib/util";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  IconButton,
  useClipboardCopy,
} from "../../shared/ui";

export interface MessageActionsProps {
  content: string;
  placement: "left" | "right";
  hasRequestId: boolean;
  hasWorkflow: boolean;
  allowMutation?: boolean;
  showInlineActions: boolean;
  onRegenerate: () => void;
  onDelete: () => void;
  onViewWorkflow: () => void;
}

export type MessageActionIntent = "copy" | "viewWorkflow" | "regenerate" | "delete";

export interface MessageActionAvailability {
  hasRequestId: boolean;
  hasWorkflow: boolean;
  allowMutation?: boolean;
}

export function readMessageActionIntents({
  hasRequestId,
  hasWorkflow,
  allowMutation = true,
}: MessageActionAvailability): MessageActionIntent[] {
  const intents: MessageActionIntent[] = ["copy"];
  if (!hasRequestId) return intents;
  if (hasWorkflow) intents.push("viewWorkflow");
  if (allowMutation) intents.push("regenerate", "delete");
  return intents;
}

export function MessageActions({
  content,
  placement,
  hasRequestId,
  hasWorkflow,
  allowMutation = true,
  showInlineActions,
  onRegenerate,
  onDelete,
  onViewWorkflow,
}: MessageActionsProps): JSX.Element {
  const { copied, copyText } = useClipboardCopy();
  const intents = readMessageActionIntents({ hasRequestId, hasWorkflow, allowMutation });
  const secondaryIntents = intents.filter((intent) => intent !== "copy");

  return (
    <div
      className={cn(
        "mt-1 flex items-center gap-0.5 opacity-0 transition-opacity group-hover/msg:opacity-100 focus-within:opacity-100",
        showInlineActions && "opacity-100",
        placement === "right" ? "justify-end" : "justify-start",
      )}
    >
      <ActionBtn label={frontendMessage("chat.action.copy")} onClick={() => void copyText(content)}>
        {copied ? <Check className="h-3.5 w-3.5 text-moss-600" /> : <Copy className="h-3.5 w-3.5" />}
      </ActionBtn>

      {secondaryIntents.length > 0 ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton
              label={frontendMessage("chat.action.more")}
              tooltip={frontendMessage("chat.action.more")}
              tooltipSide="bottom"
              size="sm"
              tone="muted"
              touchSafe
              className="h-7 w-7 rounded-md"
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </IconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align={placement === "right" ? "end" : "start"} className="min-w-[180px]">
            {secondaryIntents.map((intent) => (
              <MessageActionMenuItem
                key={intent}
                intent={intent}
                onRegenerate={onRegenerate}
                onDelete={onDelete}
                onViewWorkflow={onViewWorkflow}
              />
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}

function MessageActionMenuItem({
  intent,
  onRegenerate,
  onDelete,
  onViewWorkflow,
}: {
  intent: Exclude<MessageActionIntent, "copy">;
  onRegenerate: () => void;
  onDelete: () => void;
  onViewWorkflow: () => void;
}): JSX.Element {
  if (intent === "viewWorkflow") {
    return (
      <DropdownMenuItem icon={<GitBranch className="h-3.5 w-3.5" />} onSelect={onViewWorkflow}>
        {frontendMessage("chat.action.viewWorkflow")}
      </DropdownMenuItem>
    );
  }
  if (intent === "regenerate") {
    return (
      <DropdownMenuItem icon={<RotateCcw className="h-3.5 w-3.5" />} onSelect={onRegenerate}>
        {frontendMessage("chat.action.regenerateFromHere")}
      </DropdownMenuItem>
    );
  }
  return (
    <DropdownMenuItem icon={<Trash2 className="h-3.5 w-3.5" />} destructive onSelect={onDelete}>
      {frontendMessage("chat.action.deleteFromHere")}
    </DropdownMenuItem>
  );
}

function ActionBtn({
  children,
  label,
  onClick,
}: {
  children: ReactNode;
  label: string;
  onClick: () => void;
}): JSX.Element {
  return (
    <IconButton
      label={label}
      tooltip={label}
      tooltipSide="bottom"
      size="sm"
      tone="muted"
      touchSafe
      className="h-7 w-7 rounded-md"
      onClick={onClick}
    >
      {children}
    </IconButton>
  );
}
