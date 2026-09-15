import { Check, Copy, GitBranch, GitFork, MoreHorizontal, RotateCcw, Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { cn } from "../../lib/util";
import { MotionIconSwap } from "../../shared/motion";
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
  /** A fork creates a new session and never mutates the source conversation. */
  allowFork?: boolean;
  allowMutation?: boolean;
  allowCopy?: boolean;
  showInlineActions: boolean;
  onFork: () => void;
  onRegenerate: () => void;
  onDelete: () => void;
  onViewWorkflow: () => void;
}

export type MessageActionIntent = "copy" | "viewWorkflow" | "fork" | "regenerate" | "delete";

export interface MessageActionAvailability {
  hasRequestId: boolean;
  hasWorkflow: boolean;
  allowFork?: boolean;
  allowMutation?: boolean;
  allowCopy?: boolean;
}

export function readMessageActionIntents({
  hasRequestId,
  hasWorkflow,
  allowFork,
  allowMutation = true,
  allowCopy = true,
}: MessageActionAvailability): MessageActionIntent[] {
  const intents: MessageActionIntent[] = allowCopy ? ["copy"] : [];
  if (!hasRequestId) return intents;
  if (hasWorkflow) intents.push("viewWorkflow");
  if (allowFork ?? allowMutation) intents.push("fork");
  if (allowMutation) intents.push("regenerate", "delete");
  return intents;
}

export function MessageActions({
  content,
  placement,
  hasRequestId,
  hasWorkflow,
  allowFork,
  allowMutation = true,
  allowCopy = true,
  showInlineActions,
  onFork,
  onRegenerate,
  onDelete,
  onViewWorkflow,
}: MessageActionsProps): JSX.Element {
  const { copied, copyText } = useClipboardCopy();
  const intents = readMessageActionIntents({ hasRequestId, hasWorkflow, allowFork, allowMutation, allowCopy });
  const secondaryIntents = intents.filter((intent) => intent !== "copy");

  return (
    <div
      className={cn(
        "mt-1 flex items-center gap-0.5 opacity-0 transition-opacity group-hover/msg:opacity-100 focus-within:opacity-100",
        showInlineActions && "opacity-100",
        placement === "right" ? "justify-end" : "justify-start",
      )}
    >
      {intents.includes("copy") ? (
        <ActionBtn label={frontendMessage("chat.action.copy")} onClick={() => void copyText(content)}>
          <MotionIconSwap stateKey={copied ? "copied" : "copy"}>
            {copied ? <Check className="h-3.5 w-3.5 text-moss-600" /> : <Copy className="h-3.5 w-3.5" />}
          </MotionIconSwap>
        </ActionBtn>
      ) : null}

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
                onFork={onFork}
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
  onFork,
  onRegenerate,
  onDelete,
  onViewWorkflow,
}: {
  intent: Exclude<MessageActionIntent, "copy">;
  onFork: () => void;
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
  if (intent === "fork") {
    return (
      <DropdownMenuItem icon={<GitFork className="h-3.5 w-3.5" />} onSelect={onFork}>
        {frontendMessage("chat.action.forkFromHere")}
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
