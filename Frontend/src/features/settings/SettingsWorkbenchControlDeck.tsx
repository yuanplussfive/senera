import {
  AlertTriangle,
  Check,
  Info,
  Loader2,
} from "lucide-react";
import { cn } from "../../lib/util";
import type { SettingsDraftInteraction } from "./settingsInteractionModel";
import type {
  SettingsWorkbenchSectionSummary,
  SettingsWorkbenchSummaryTone,
} from "./settingsPresentation";
import type { SettingsSectionDefinition } from "./types";

export function WorkbenchControlDeckHeader({
  configInteraction,
  section,
  summary,
}: {
  configInteraction: SettingsDraftInteraction;
  section: SettingsSectionDefinition;
  summary: SettingsWorkbenchSectionSummary;
}): JSX.Element {
  const Icon = section.icon;
  const tone = summary.actionKind === "config"
    ? readDraftTone(configInteraction.tone)
    : summary.statusTone;
  const StatusIcon = summaryToneIcon[tone];
  const statusText = summary.actionKind === "config" ? configInteraction.statusLabel : summary.statusLabel;
  const statusDetail = summary.disabledReason ?? (
    summary.actionKind === "config" ? summary.actionSurfaceDetail : summary.statusDetail
  );

  return (
    <header className="shrink-0 border-b border-ink-200/70 bg-paper-50/95">
      <div className="grid min-h-[72px] grid-cols-[minmax(0,1fr)] gap-3 px-5 py-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
        <div className="flex min-w-0 items-center gap-3">
          <span className={cn(
            "grid h-10 w-10 shrink-0 place-items-center rounded-md border",
            section.enabled
              ? "border-ink-200 bg-paper-100 text-ink-650"
              : "border-ink-200 bg-paper-100 text-ink-350",
          )}>
            <Icon className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <div className="flex min-w-0 items-center">
              <h2 className="truncate text-[18px] font-semibold leading-6 text-ink-950">{section.label}</h2>
            </div>
            <p className="mt-0.5 max-w-[760px] text-[12px] leading-5 text-ink-500">{section.description}</p>
          </div>
        </div>

        <div className={cn(
          "flex min-w-0 items-start gap-2 rounded-md border px-2.5 py-2 text-[11.5px] leading-4 lg:max-w-[340px]",
          statusToneClassName[tone],
        )}>
          <StatusIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <div className="min-w-0">
            <div className="font-semibold">{statusText}</div>
            <div className="mt-0.5 line-clamp-2 opacity-80">{statusDetail}</div>
          </div>
        </div>
      </div>
    </header>
  );
}

const summaryToneIcon = {
  danger: AlertTriangle,
  info: Loader2,
  neutral: Info,
  success: Check,
  warning: AlertTriangle,
} as const;

const statusToneClassName = {
  danger: "border-brick-200 bg-brick-50 text-brick-700",
  info: "border-sky-200 bg-sky-50 text-sky-800",
  neutral: "border-ink-200 bg-paper-100 text-ink-550",
  success: "border-moss-200 bg-moss-50 text-moss-800",
  warning: "border-amber-200 bg-amber-50 text-amber-900",
} as const;

function readDraftTone(tone: SettingsDraftInteraction["tone"]): SettingsWorkbenchSummaryTone {
  switch (tone) {
    case "success":
      return "success";
    case "info":
      return "info";
    case "warning":
      return "warning";
    case "neutral":
    default:
      return "neutral";
  }
}
