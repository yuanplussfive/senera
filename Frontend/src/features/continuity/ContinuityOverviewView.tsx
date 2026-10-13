import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import type { RunRecord } from "../../store/sessionStore";
import { ContinuityRecallView } from "./ContinuityRecallView";

export function ContinuityOverviewView({ run }: { run: RunRecord }): JSX.Element {
  const memory = run.continuity;
  if (!memory) throw new Error("Continuity overview requires a turn snapshot.");
  return (
    <section data-continuity-overview>
      <header className="mx-4 border-b border-line-subtle py-3">
        <p className="text-[10px] text-content-muted">
          {frontendMessage(memory.enabled ? "continuity.overview.active" : "continuity.overview.paused")}
        </p>
        <p className="mt-1 text-[11px] text-content-secondary">
          {frontendMessage("continuity.overview.summary", {
            count: memory.selection.digests.selected + memory.selection.events.selected,
          })}
        </p>
        <p className="mt-1 text-[10px] tabular-nums text-content-muted">
          {memory.selection.usedTokens} / {memory.selection.maxTokens} tokens
        </p>
      </header>
      <ContinuityRecallView run={run} showTitle={false} />
    </section>
  );
}
