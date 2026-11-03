import { useState } from "react";
import { ExecutionApprovalModes, type ExecutionApprovalMode } from "../../api/executionApprovalMode";
import type { SandboxStatusSnapshotData } from "../../api/eventTypes";
import { frontendMessage, type FrontendMessageKey } from "../../i18n/frontendMessageCatalog";
import { cn } from "../../lib/util";
import { useWorkspaceMenu } from "../../shared/workspace/workspaceMenuContext";
import {
  ActivityStatusIcon,
  AppIcon,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Spinner,
  Tooltip,
  type AppIconName,
} from "../../shared/ui";
import { sandboxStatusDetail } from "../sandbox/sandboxPreparationPresentation";
import { composerControlClassName } from "./composerControls";

const ApprovalModePresentation = {
  [ExecutionApprovalModes.AlwaysAsk]: {
    labelKey: "chat.approvalMode.alwaysAsk",
    descriptionKey: "chat.approvalMode.alwaysAskDescription",
    icon: "shield-alert",
  },
  [ExecutionApprovalModes.Agent]: {
    labelKey: "chat.approvalMode.agent",
    descriptionKey: "chat.approvalMode.agentDescription",
    icon: "shield",
  },
  [ExecutionApprovalModes.FullAccess]: {
    labelKey: "chat.approvalMode.fullAccess",
    descriptionKey: "chat.approvalMode.fullAccessDescription",
    icon: "unlock",
  },
} as const satisfies Record<
  ExecutionApprovalMode,
  { labelKey: FrontendMessageKey; descriptionKey: FrontendMessageKey; icon: AppIconName }
>;

/**
 * The boundary is a machine fact, not a setting. A healthy environment (sandbox
 * ready, or host execution as configured through `state: "disabled"`) has no
 * decision value inside the composer, so it stays invisible; only a state the
 * user must not mistake for "isolated" surfaces — a missing boundary or one
 * still being prepared.
 */
type BoundaryAttention = "preparing" | "unavailable";

function readBoundaryAttention(status?: SandboxStatusSnapshotData | null): BoundaryAttention | null {
  if (!status) return null;
  if (status.state === "preparing") return "preparing";
  if (status.state === "unavailable") return "unavailable";
  return null;
}

/** A blocked boundary is an error; a preparing one is a wait. They never share a color. */
const attentionPresentation: Record<BoundaryAttention, { labelKey: FrontendMessageKey; tone: string }> = {
  preparing: { labelKey: "sandbox.status.preparing", tone: "text-umber-600" },
  unavailable: { labelKey: "sandbox.status.unavailable", tone: "text-brick-600" },
};

export interface ExecutionContextChipProps {
  sandboxStatus?: SandboxStatusSnapshotData | null;
  approval: { mode: ExecutionApprovalMode; disabled: boolean; onSelect: (mode: ExecutionApprovalMode) => void };
  prefersCompactControls: boolean;
  /** Where the full boundary explanation lives; absent means the chip stays inert. */
  onOpenExecutionPanel?: () => void;
}

/**
 * Two answers about this turn, kept apart: where it runs (workspace) and how
 * much autonomy it gets (approval). The boundary joins only when it needs
 * attention, and then as a status badge — never as a second dropdown.
 */
export function ExecutionContextChip({
  sandboxStatus,
  approval,
  prefersCompactControls,
  onOpenExecutionPanel,
}: ExecutionContextChipProps): JSX.Element {
  const menu = useWorkspaceMenu();
  const [boundaryOpen, setBoundaryOpen] = useState(false);

  const snapshot = menu?.workspace.snapshot;
  const active = snapshot?.workspaces.find((entry) => entry.id === snapshot.workspaceId);
  const workspaceName = active?.name ?? frontendMessage("resource.workspace");
  const switching = menu?.workspace.phase === "switching";
  const attention = readBoundaryAttention(sandboxStatus);
  const attentionDetail = attention ? sandboxStatusDetail(sandboxStatus) : "";

  const approvalPresentation = ApprovalModePresentation[approval.mode];
  const approvalLabel = frontendMessage(approvalPresentation.labelKey);
  const controlClassName = composerControlClassName(prefersCompactControls);

  return (
    <div
      className={cn("inline-flex min-w-0 items-center gap-1", prefersCompactControls && "shrink")}
      data-execution-context
    >
      {/* Where this turn runs. The switcher itself stays owned by the workspace
          module, so its dirty-edit dialogs survive this button unmounting. */}
      {menu ? (
        <button
          type="button"
          data-execution-context-part="workspace"
          aria-label={frontendMessage("execution.context.workspaceAria", { name: workspaceName })}
          onClick={() => menu.openPanel()}
          className={cn(
            "group inline-flex min-w-0 items-center gap-1.5 rounded-lg px-2 text-xs leading-5 text-content-secondary transition-colors hover:bg-surface-hover hover:text-content-primary",
            "focus-visible:outline-none focus-visible:bg-surface-hover focus-visible:ring-2 focus-visible:ring-accent-focus",
            controlClassName,
          )}
        >
          <AppIcon icon="folder" size={14} className="shrink-0 text-content-muted" aria-hidden="true" />
          {switching ? (
            <Spinner size="xs" />
          ) : (
            <>
              <span className="max-w-[7.5rem] truncate" title={snapshot?.workspaceRoot}>
                {workspaceName}
              </span>
              <AppIcon icon="chevron-down" size={10} className="shrink-0 text-content-muted" aria-hidden="true" />
            </>
          )}
        </button>
      ) : null}

      {/* Status, not a picker: one icon, a colored label, and the explanation on
          demand. It never carries a caret, so it cannot be mistaken for a menu. */}
      {attention ? (
        <Popover open={boundaryOpen} onOpenChange={setBoundaryOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              data-execution-context-part="boundary"
              data-boundary-attention={attention}
              aria-label={`${frontendMessage(attentionPresentation[attention].labelKey)}：${attentionDetail}`}
              className={cn(
                "inline-flex min-w-0 items-center gap-1.5 rounded-lg px-2 text-xs leading-5 transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus",
                attentionPresentation[attention].tone,
                controlClassName,
              )}
            >
              {attention === "preparing" ? (
                <ActivityStatusIcon status="running" motion="spin" size={13} />
              ) : (
                <AppIcon icon="shield-alert" size={14} aria-hidden="true" />
              )}
              <span
                className={cn("max-w-[9rem] truncate", prefersCompactControls && attention === "preparing" && "hidden")}
              >
                {frontendMessage(attentionPresentation[attention].labelKey)}
              </span>
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" side="top" sideOffset={6} className="w-[min(22rem,calc(100vw-2rem))]">
            <p className={cn("text-[12.5px] font-semibold", attentionPresentation[attention].tone)}>
              {frontendMessage(attentionPresentation[attention].labelKey)}
            </p>
            <p className="mt-1 text-[12px] leading-5 text-content-secondary">{attentionDetail}</p>
            {onOpenExecutionPanel ? (
              <>
                <div className="my-2 h-px bg-line-subtle" />
                <button
                  type="button"
                  onClick={() => {
                    setBoundaryOpen(false);
                    onOpenExecutionPanel();
                  }}
                  className="inline-flex items-center gap-1 rounded-md text-[12px] font-medium text-accent-content transition-colors hover:text-accent-content-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus"
                  data-execution-context-open-panel
                >
                  {frontendMessage("execution.context.openExecutionPanel")}
                  <AppIcon icon="chevron-right" size={12} aria-hidden="true" />
                </button>
              </>
            ) : null}
          </PopoverContent>
        </Popover>
      ) : null}

      {/* How much autonomy this turn gets — the only part the composer can change,
             so it keeps a disclosure affordance and sits nearest the send button. */}
      <DropdownMenu>
        <Tooltip content={approvalLabel} side="top">
          <DropdownMenuTrigger asChild disabled={approval.disabled}>
            <button
              type="button"
              data-execution-context-part="approval"
              aria-label={approvalLabel}
              className={cn(
                "inline-flex min-w-0 items-center gap-1.5 rounded-lg px-2 text-xs leading-5 text-content-secondary transition-colors hover:bg-surface-hover hover:text-content-primary data-[state=open]:bg-surface-muted",
                "focus-visible:outline-none focus-visible:bg-surface-hover focus-visible:ring-2 focus-visible:ring-accent-focus",
                "disabled:pointer-events-none disabled:opacity-55",
                controlClassName,
              )}
            >
              <AppIcon icon={approvalPresentation.icon} size={14} className="shrink-0" aria-hidden="true" />
              <span className="max-w-[6rem] truncate">{approvalLabel}</span>
              <AppIcon icon="chevron-down" size={10} className="shrink-0 text-content-muted" aria-hidden="true" />
            </button>
          </DropdownMenuTrigger>
        </Tooltip>
        <DropdownMenuContent align="start" side="top" className="w-[min(340px,calc(100vw-24px))] p-1.5">
          <DropdownMenuLabel className="pb-2.5 font-normal normal-case tracking-normal">
            {frontendMessage("chat.approvalMode.heading")}
          </DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={approval.mode}
            onValueChange={(value) => approval.onSelect(value as ExecutionApprovalMode)}
          >
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
                  {/* Title states the policy; the second line states what it means,
                      so the three options differ by consequence, not by adjective. */}
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
    </div>
  );
}
