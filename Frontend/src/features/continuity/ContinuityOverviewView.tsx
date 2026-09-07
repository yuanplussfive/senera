import { ChevronDown } from "lucide-react";
import { frontendMessage, type FrontendMessageKey } from "../../i18n/frontendMessageCatalog";
import type { RunRecord } from "../../store/sessionStore";
import { ContinuityEmptyText } from "./ContinuityPanelPrimitives";

/** A quiet, editorial index of the context that actually entered this turn. */
export function ContinuityOverviewView({ run }: { run: RunRecord }): JSX.Element {
  const continuity = run.continuity;
  if (!continuity) throw new Error("Continuity overview requires a turn snapshot.");

  const selectedCount = sumSelectedContinuityEntries(continuity.selection);
  const anchors = run.recall?.local?.anchorLabels ?? [];

  return (
    <section className="space-y-4 px-4 py-3.5" data-continuity-overview>
      <header className="border-b border-line-subtle pb-3">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-[10px] font-medium tracking-[0.06em] text-accent-content">
            {frontendMessage(continuity.enabled ? "continuity.overview.active" : "continuity.overview.paused")}
          </p>
          <span className="shrink-0 text-[9px] tabular-nums text-content-muted">
            {continuity.selection.usedCharacters} / {continuity.selection.maxCharacters} ch
          </span>
        </div>
        <h3 className="mt-1 text-[15px] font-medium leading-6 text-content-primary">
          {frontendMessage("continuity.overview.title")}
        </h3>
        <p className="mt-1 text-[10.5px] leading-5 text-content-secondary">
          {frontendMessage("continuity.overview.summary", { count: selectedCount })}
        </p>
      </header>

      <section className="space-y-3" aria-labelledby="continuity-overview-identity">
        <SectionHeading id="continuity-overview-identity" title="continuity.group.identity" />
        <PresetLine run={run} />
        <ProfileAnchors run={run} />
      </section>

      <section className="space-y-2.5" aria-labelledby="continuity-overview-anchors">
        <SectionHeading id="continuity-overview-anchors" title="continuity.overview.anchors" />
        {anchors.length === 0 ? (
          <ContinuityEmptyText>{frontendMessage("continuity.overview.emptyAnchors")}</ContinuityEmptyText>
        ) : (
          <ol className="divide-y divide-line-subtle border-y border-line-subtle">
            {anchors.map((anchor, index) => (
              <li
                key={anchor}
                className="flex min-w-0 items-baseline gap-2 py-2 transition-colors hover:bg-surface-hover first:pt-2 last:pb-2"
              >
                <span className="w-5 shrink-0 font-mono text-[9px] tabular-nums text-content-disabled">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span className="min-w-0 break-words text-[10.5px] leading-5 text-content-primary">{anchor}</span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </section>
  );
}

function PresetLine({ run }: { run: RunRecord }): JSX.Element {
  const preset = run.continuity?.preset;
  if (!preset?.enabled) {
    return <ContinuityEmptyText>{frontendMessage("continuity.presetInactive")}</ContinuityEmptyText>;
  }
  if (!preset.corePersona && !preset.languageStyle) {
    return (
      <div className="border-l-2 border-accent-border pl-2.5">
        <p className="text-[11.5px] font-medium leading-5 text-content-primary">
          {preset.title ?? preset.activePresetName}
        </p>
      </div>
    );
  }
  return (
    <details className="group border-l-2 border-accent-border pl-2.5">
      <summary className="flex min-w-0 cursor-pointer list-none items-center gap-2 [&::-webkit-details-marker]:hidden">
        <p className="min-w-0 flex-1 truncate text-[11.5px] font-medium leading-5 text-content-primary">
          {preset.title ?? preset.activePresetName}
        </p>
        <ChevronDown
          className="h-3.5 w-3.5 shrink-0 text-content-muted transition-transform group-open:rotate-180"
          aria-hidden="true"
        />
      </summary>
      <div className="mt-1.5">
        {preset.corePersona ? (
          <p className="break-words text-[10.5px] leading-5 text-content-secondary">{preset.corePersona}</p>
        ) : null}
        {preset.languageStyle ? (
          <p className="mt-0.5 break-words text-[10px] leading-4 text-content-muted">{preset.languageStyle}</p>
        ) : null}
      </div>
    </details>
  );
}

function SectionHeading({ id, title }: { id: string; title: FrontendMessageKey }): JSX.Element {
  return (
    <h4
      id={id}
      className="min-w-0 truncate border-l border-accent-border pl-2 text-[10px] font-medium leading-4 text-content-secondary"
    >
      {frontendMessage(title)}
    </h4>
  );
}

function ProfileAnchors({ run }: { run: RunRecord }): JSX.Element {
  const entries = run.continuity?.residentProfile ?? [];
  if (entries.length === 0) {
    return <ContinuityEmptyText>{frontendMessage("continuity.emptyResidentProfile")}</ContinuityEmptyText>;
  }
  return (
    <ul className="space-y-2" aria-label={frontendMessage("continuity.residentProfile")}>
      {entries.map((entry) => (
        <li
          key={`${entry.subject}:${entry.key}`}
          className="min-w-0 border-l border-line-strong pl-2 transition-colors hover:bg-surface-hover"
        >
          <p className="text-[9.5px] leading-4 text-content-muted">{entry.key}</p>
          <p className="break-words text-[10.5px] leading-4 text-content-secondary">{entry.claim}</p>
        </li>
      ))}
    </ul>
  );
}

function sumSelectedContinuityEntries(selection: NonNullable<RunRecord["continuity"]>["selection"]): number {
  return (
    selection.profiles.selected +
    selection.facts.selected +
    (selection.relations?.selected ?? 0) +
    selection.events.selected +
    selection.evidence.selected
  );
}
