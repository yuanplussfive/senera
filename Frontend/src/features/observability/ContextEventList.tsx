import { Virtuoso } from "react-virtuoso";
import { frontendFeatureMessage as t } from "../../i18n/frontendFeatureMessageCatalog";
import { formatInteger, formatTime } from "../../lib/util";
import { AppIcon } from "../../shared/ui";
import type { InsightContextEvent } from "./contextEventModel";

const EventIcons = {
  initial: "context-window",
  added: "plus",
  removed: "minus",
  model: "git-branch",
  compaction: "archive",
} as const;

export function ContextEventList({
  events,
  onInspectRequest,
}: {
  events: readonly InsightContextEvent[];
  onInspectRequest: (id: string) => void;
}): JSX.Element {
  return (
    <Virtuoso
      className="insights-execution-list"
      data={events}
      computeItemKey={(_index, event) => event.id}
      itemContent={(_index, event) => <ContextEventRow event={event} onInspectRequest={onInspectRequest} />}
    />
  );
}

export function ContextEventRow({
  event,
  onInspectRequest,
}: {
  event: InsightContextEvent;
  onInspectRequest: (id: string) => void;
}): JSX.Element {
  const body = (
    <>
      <AppIcon icon={EventIcons[event.kind]} size={14} />
      <span className="insights-context-event-copy">
        <span className="insights-context-event-title">
          <b>{t(`insights.events.kind.${event.kind}`)}</b>
          <span>{event.label}</span>
        </span>
        <small>
          {[
            event.source,
            t("insights.turn", { index: event.turn }),
            event.step === undefined ? undefined : t("insights.process.step", { index: event.step }),
          ]
            .filter(Boolean)
            .join(" · ")}
        </small>
      </span>
      <span className="insights-context-event-tail">
        {event.tokens === undefined ? null : (
          <span
            data-delta={event.tokens < 0 ? "decrease" : "increase"}
            title={event.estimated ? t("insights.context.localEstimate") : undefined}
          >
            {event.estimated ? "≈" : ""}
            {event.tokens > 0 ? "+" : ""}
            {formatInteger(event.tokens)}
          </span>
        )}
        <time dateTime={event.timestamp}>{formatTime(event.timestamp)}</time>
      </span>
      {event.requestId ? <AppIcon icon="chevron-right" size={12} /> : null}
    </>
  );
  return (
    <article className="insights-context-event-entry" data-context-event={event.kind}>
      {event.requestId ? (
        <button type="button" className="insights-event-row" onClick={() => onInspectRequest(event.requestId!)}>
          {body}
        </button>
      ) : (
        <div className="insights-event-row">{body}</div>
      )}
    </article>
  );
}
