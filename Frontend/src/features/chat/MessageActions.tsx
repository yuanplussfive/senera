import { Check, Copy, GitBranch, RotateCcw, Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../../lib/util";
import { IconButton, useClipboardCopy } from "../../shared/ui";

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
              <ActionBtn key={intent} label="复制" onClick={onCopy}>
                {copied ? <Check className="h-3.5 w-3.5 text-moss-500" /> : <Copy className="h-3.5 w-3.5" />}
              </ActionBtn>
            );
          case "viewWorkflow":
            return (
              <ActionBtn key={intent} label="查看工作流" onClick={onViewWorkflow}>
                <GitBranch className="h-3.5 w-3.5" />
              </ActionBtn>
            );
          case "regenerate":
            return (
              <ActionBtn key={intent} label="从此处重新回答" onClick={onRegenerate}>
                <RotateCcw className="h-3.5 w-3.5" />
              </ActionBtn>
            );
          case "delete":
            return (
              <ActionBtn key={intent} label="从此处删除" onClick={onDelete} destructive>
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
