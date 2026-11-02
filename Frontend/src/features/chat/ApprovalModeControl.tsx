import { ExecutionApprovalModes, type ExecutionApprovalMode } from "../../api/executionApprovalMode";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { cn } from "../../lib/util";
import { MotionButton } from "../../shared/motion";
import { composerControlClassName } from "./composerControls";
import {
  AppIcon,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
  Tooltip,
} from "../../shared/ui";

const ApprovalModePresentation = {
  [ExecutionApprovalModes.AlwaysAsk]: {
    labelKey: "chat.approvalMode.alwaysAsk",
    icon: "shield-alert",
    descriptionKey: "chat.approvalMode.alwaysAskDescription",
  },
  [ExecutionApprovalModes.Agent]: {
    labelKey: "chat.approvalMode.agent",
    icon: "shield",
    descriptionKey: "chat.approvalMode.agentDescription",
  },
  [ExecutionApprovalModes.FullAccess]: {
    labelKey: "chat.approvalMode.fullAccess",
    icon: "unlock",
    descriptionKey: "chat.approvalMode.fullAccessDescription",
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
  const selectedLabel = frontendMessage(selected.labelKey);

  return (
    <DropdownMenu>
      <Tooltip content={selectedLabel} side="top">
        <DropdownMenuTrigger asChild disabled={disabled}>
          <MotionButton
            className={cn(
              "inline-flex min-w-0 items-center gap-1.5 rounded-lg px-2 text-xs leading-5 text-content-secondary transition hover:bg-surface-hover hover:text-content-primary",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus",
              composerControlClassName(prefersCompactControls),
              prefersCompactControls && "min-w-11 justify-center",
              disabled && "pointer-events-none opacity-55",
            )}
            aria-label={selectedLabel}
          >
            <AppIcon icon={selected.icon} size={16} />
            {!prefersCompactControls ? <span className="max-w-24 truncate">{selectedLabel}</span> : null}
            {!prefersCompactControls ? <AppIcon icon="chevron-down" size={12} className="text-content-muted" /> : null}
          </MotionButton>
        </DropdownMenuTrigger>
      </Tooltip>
      <DropdownMenuContent align="start" side="top" className="w-[min(340px,calc(100vw-24px))] p-1.5">
        <DropdownMenuLabel className="pb-2.5 font-normal normal-case tracking-normal">
          {frontendMessage("chat.approvalMode.heading")}
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup value={mode} onValueChange={(value) => onSelect(value as ExecutionApprovalMode)}>
          {(Object.keys(ApprovalModePresentation) as ExecutionApprovalMode[]).map((candidate) => {
            const presentation = ApprovalModePresentation[candidate];
            return (
              <DropdownMenuRadioItem
                key={candidate}
                value={candidate}
                className="min-h-14 py-2.5"
                icon={
                  <AppIcon
                    icon={presentation.icon}
                    size={17}
                    className={candidate === ExecutionApprovalModes.FullAccess ? "text-umber-600" : undefined}
                  />
                }
              >
                <span className="block text-[13px] font-medium leading-5">
                  {frontendMessage(presentation.labelKey)}
                </span>
                <span className="mt-0.5 block whitespace-normal text-xs font-normal leading-5 text-content-muted">
                  {frontendMessage(presentation.descriptionKey)}
                </span>
              </DropdownMenuRadioItem>
            );
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default ApprovalModeControl;
