import { Check, Copy, GitBranch, GitFork, RotateCcw, Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { cn } from "../../lib/util";
import { IconButton, useClipboardCopy } from "../../shared/ui";

export interface MessageActionsProps {
  content: string;
  placement: "left" | "right";
  hasRequestId: boolean;
  hasWorkflow: boolean;
  allowMutation?: boolean;
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
  if (allowMutation) intents.push("fork", "regenerate", "delete");
  return intents;
}

export function MessageActions({
  content,
  placement,
  hasRequestId,
  hasWorkflow,
  allowMutation = true,
  showInlineActions,
  onFork,
  onRegenerate,
  onDelete,
  onViewWorkflow,
}: MessageActionsProps): JSX.Element {
  const { copied, copyText } = useClipboardCopy();
  const onCopy = async (): Promise<void> => {
    await copyText(content);
  };
  const intents = readMessageActionIntents({ hasRequestId, hasWorkflow, allowMutation });

  return (
    <div
      className={cn(
        "mt-1.5 flex items-center gap-0.5 opacity-0 transition group-hover/msg:opacity-100 focus-within:opacity-100",
        showInlineActions && "opacity-100",
        placement === "right" ? "justify-end" : "justify-start",
      )}
    >
      {intents.map((intent) => {
        switch (intent) {
          case "copy":
            return (
              <ActionBtn key={intent} label={frontendMessage("chat.action.copy")} onClick={onCopy}>
                {copied ? <Check className="h-3.5 w-3.5 text-moss-500" /> : <Copy className="h-3.5 w-3.5" />}
              </ActionBtn>
            );
          case "viewWorkflow":
            return (
              <ActionBtn key={intent} label={frontendMessage("chat.action.viewWorkflow")} onClick={onViewWorkflow}>
                <GitBranch className="h-3.5 w-3.5" />
              </ActionBtn>
            );
          case "fork":
            return (
              <ActionBtn key={intent} label={frontendMessage("chat.action.forkFromHere")} onClick={onFork}>
                <GitFork className="h-3.5 w-3.5" />
              </ActionBtn>
            );
          case "regenerate":
            return (
              <ActionBtn key={intent} label={frontendMessage("chat.action.regenerateFromHere")} onClick={onRegenerate}>
                <RotateCcw className="h-3.5 w-3.5" />
              </ActionBtn>
            );
          case "delete":
            return (
              <ActionBtn
                key={intent}
                label={frontendMessage("chat.action.deleteFromHere")}
                onClick={onDelete}
                destructive
              >
                <Trash2 className="h-3.5 w-3.5" />
              </ActionBtn>
            );
        }
      })}
    </div>
  );
}

function ActionBtn({
  children,
  label,
  onClick,
  destructive = false,
}: {
  children: ReactNode;
  label: string;
  onClick: () => void;
  destructive?: boolean;
}): JSX.Element {
  return (
    <IconButton
      label={label}
      tooltip={label}
      tooltipSide="bottom"
      size="sm"
      tone={destructive ? "danger" : "muted"}
      touchSafe
      className="h-7 w-7 rounded-md"
      onClick={onClick}
    >
      {children}
    </IconButton>
  );
}
