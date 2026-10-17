import { Check, ChevronDown, LockOpen, ShieldCheck, ShieldQuestion } from "lucide-react";
import { ExecutionApprovalModes, type ExecutionApprovalMode } from "../../api/executionApprovalMode";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { cn } from "../../lib/util";
import { MotionButton } from "../../shared/motion";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, Tooltip } from "../../shared/ui";

const ApprovalModePresentation = {
  [ExecutionApprovalModes.AlwaysAsk]: {
    labelKey: "chat.approvalMode.alwaysAsk",
    icon: ShieldQuestion,
  },
  [ExecutionApprovalModes.Agent]: {
    labelKey: "chat.approvalMode.agent",
    icon: ShieldCheck,
  },
  [ExecutionApprovalModes.FullAccess]: {
    labelKey: "chat.approvalMode.fullAccess",
    icon: LockOpen,
  },
} as const;

export interface ApprovalModeControlProps {
  disabled: boolean;
  mode: ExecutionApprovalMode;
  onSelect: (mode: ExecutionApprovalMode) => void;
  prefersCompactControls: boolean;
}

function ApprovalModeControl({
  disabled,
  mode,
  onSelect,
  prefersCompactControls,
}: ApprovalModeControlProps): JSX.Element {
  const selected = ApprovalModePresentation[mode];
  const SelectedIcon = selected.icon;
  const selectedLabel = frontendMessage(selected.labelKey);

  return (
    <DropdownMenu>
      <Tooltip content={selectedLabel} side="top">
        <DropdownMenuTrigger asChild disabled={disabled}>
          <MotionButton
            className={cn(
              "inline-flex h-9 min-w-0 items-center gap-1.5 rounded-md px-2 text-[11px] text-content-secondary transition hover:bg-surface-hover hover:text-content-primary sm:h-7",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus",
              prefersCompactControls && "min-h-11 min-w-11 justify-center",
              disabled && "pointer-events-none opacity-55",
            )}
            aria-label={selectedLabel}
          >
            <SelectedIcon className="h-3.5 w-3.5 shrink-0" />
            {!prefersCompactControls ? <span className="max-w-24 truncate">{selectedLabel}</span> : null}
            {!prefersCompactControls ? <ChevronDown className="h-3 w-3 shrink-0 text-content-muted" /> : null}
          </MotionButton>
        </DropdownMenuTrigger>
      </Tooltip>
      <DropdownMenuContent align="end" side="top" className="w-[min(230px,calc(100vw-24px))]">
        {(Object.keys(ApprovalModePresentation) as ExecutionApprovalMode[]).map((candidate) => {
          const presentation = ApprovalModePresentation[candidate];
          const ModeIcon = presentation.icon;
          const active = candidate === mode;
          return (
            <DropdownMenuItem
              key={candidate}
              onSelect={() => onSelect(candidate)}
              icon={<ModeIcon className="h-3.5 w-3.5" />}
            >
              <span className="flex min-w-0 items-center justify-between gap-3">
                <span className="truncate">{frontendMessage(presentation.labelKey)}</span>
                {active ? <Check className="h-3.5 w-3.5 shrink-0 text-accent-content" /> : null}
              </span>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default ApprovalModeControl;
