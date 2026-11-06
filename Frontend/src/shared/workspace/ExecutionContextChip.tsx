import { useContext } from "react";
import { ExecutionApprovalModes, type ExecutionApprovalMode } from "../../api/executionApprovalMode";
import type { SandboxStatusSnapshotData } from "../../api/eventTypes";
import { frontendMessage, type FrontendMessageKey } from "../../i18n/frontendMessageCatalog";
import { cn } from "../../lib/util";
import {
  AppIcon,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Spinner,
  type AppIconName,
} from "../ui";
import { sandboxStatusDetail } from "../../features/sandbox/sandboxPreparationPresentation";
import { WorkspaceMenuContext } from "./WorkspaceMenuContext";

const ApprovalModePresentation = {
  [ExecutionApprovalModes.AlwaysAsk]: {
    labelKey: "chat.approvalMode.alwaysAsk",
    descriptionKey: "chat.approvalMode.alwaysAskDescription",
    icon: "shield",
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
const attentionPresentation: Record<
  BoundaryAttention,
  { labelKey: FrontendMessageKey; icon: AppIconName; tone: string }
> = {
  preparing: { labelKey: "sandbox.status.preparing", icon: "progress", tone: "text-umber-600" },
  unavailable: { labelKey: "sandbox.status.unavailable", icon: "shield-off", tone: "text-brick-600" },
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
  const menu = useContext(WorkspaceMenuContext);

  const snapshot = menu?.workspace.snapshot;
  const active = snapshot?.workspaces.find((entry) => entry.id === snapshot.workspaceId);
  const workspaceName = active?.name ?? frontendMessage("resource.workspace");
  const switching = menu?.workspace.phase === "switching";
  const attention = readBoundaryAttention(sandboxStatus);
  const attentionDetail = attention ? sandboxStatusDetail(sandboxStatus) : "";

  const approvalPresentation = ApprovalModePresentation[approval.mode];
  const approvalLabel = frontendMessage(approvalPresentation.labelKey);

  return (
    <div
      className={cn("inline-flex min-w-0 items-center gap-1", prefersCompactControls && "shrink")}
      data-execution-context
    >
      {menu ? (
        <button
          type="button"
          data-execution-context-part="workspace"
          aria-label={frontendMessage("execution.context.workspaceAria", { name: workspaceName })}
          title={snapshot?.workspaceRoot}
          onClick={() => menu.openPanel()}
          className={cn(
            "group inline-flex h-8 min-w-0 items-center gap-1.5 rounded-md px-2 text-[12px] font-medium text-content-secondary transition-colors hover:bg-surface-hover focus-visible:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus",
            prefersCompactControls && "h-11",
          )}
        >
          <AppIcon icon="folder" size={14} className="shrink-0 text-content-muted" aria-hidden="true" />
          {switching ? (
            <Spinner size="xs" />
          ) : (
            <>
              <span className="max-w-[7.5rem] truncate">{workspaceName}</span>
              <AppIcon icon="chevron-down" size={10} className="shrink-0 text-content-muted" aria-hidden="true" />
            </>
          )}
        </button>
      ) : null}

      {/* Status, not a picker: one icon, a colored label, and the explanation on
             demand. It never carries a caret, so it cannot be mistaken for a menu. */}
      {attention ? (
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              data-execution-context-part="boundary"
              data-boundary-attention={attention}
              aria-label={`${frontendMessage(attentionPresentation[attention].labelKey)}：${attentionDetail}`}
              className={cn(
                "inline-flex h-8 min-w-0 items-center gap-1.5 rounded-md px-2 text-[12px] font-medium transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus",
                attentionPresentation[attention].tone,
                prefersCompactControls && "h-11",
              )}
            >
              {attention === "preparing" ? (
                <Spinner size="xs" />
              ) : (
                <AppIcon
                  icon={attentionPresentation[attention].icon}
                  size={13}
                  className="shrink-0"
                  aria-hidden="true"
                />
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
                  onClick={onOpenExecutionPanel}
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
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            disabled={approval.disabled}
            data-execution-context-part="approval"
            aria-label={approvalLabel}
            className={cn(
              "inline-flex h-8 min-w-0 items-center gap-1.5 rounded-md px-2 text-[12px] font-medium text-content-secondary transition-colors hover:bg-surface-hover data-[state=open]:bg-surface-muted focus-visible:outline-none focus-visible:bg-surface-hover focus-visible:ring-2 focus-visible:ring-accent-focus disabled:pointer-events-none disabled:opacity-55",
              prefersCompactControls && "h-11",
            )}
          >
            <AppIcon icon={approvalPresentation.icon} size={14} className="shrink-0" aria-hidden="true" />
            <span className="max-w-[6rem] truncate">{approvalLabel}</span>
            <AppIcon icon="chevron-down" size={10} className="shrink-0 text-content-muted" aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" side="top" className="w-[min(268px,calc(100vw-24px))]">
          {(Object.keys(ApprovalModePresentation) as ExecutionApprovalMode[]).map((candidate) => {
            const presentation = ApprovalModePresentation[candidate];
            const isActive = candidate === approval.mode;
            return (
              <DropdownMenuItem
                key={candidate}
                onSelect={() => approval.onSelect(candidate)}
                stacked
                icon={<AppIcon icon={presentation.icon} size={14} aria-hidden="true" />}
                trailing={
                  isActive ? (
                    <AppIcon icon="checkmark" size={13} className="text-accent-content" aria-hidden="true" />
                  ) : null
                }
              >
                {/* Title states the policy; the second line states what it means,
                    so the three options differ by consequence, not by adjective. */}
                <span className="block truncate">{frontendMessage(presentation.labelKey)}</span>
                <span className="mt-0.5 block whitespace-normal text-[11.5px] leading-4 text-content-muted">
                  {frontendMessage(presentation.descriptionKey)}
                </span>
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
