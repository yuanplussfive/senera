import { useDeferredValue, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { Virtuoso } from "react-virtuoso";
import type {
  AgentModelContextCategory,
  AgentModelContextSection,
} from "../../../../Source/AgentSystem/Events/AgentModelContextSnapshot";
import { readWorkspaceResource } from "../../api/workspaceResourceClient";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { frontendFeatureMessage as t } from "../../i18n/frontendFeatureMessageCatalog";
import { formatInteger } from "../../lib/util";
import type { RunRecord } from "../../store/sessionStore";
import {
  AppIcon,
  Button,
  IconButton,
  InlineError,
  Input,
  MenuSelect,
  Spinner,
  Tooltip,
  useClipboardCopy,
} from "../../shared/ui";
import { useWorkspaceResourceController } from "../../shared/workspace/WorkspaceResourceProvider";
import {
  ContextCategoryPresentation,
  contextChanges,
  contextComposition,
  modelRequests,
  providerReportedRequestContextTokens,
  requestContextUsage,
  requestContextUsageDelta,
} from "./contextInspectionModel";
import { inspectionScopeId } from "./inspectionScopeModel";
import { InsightsSectionTitle } from "./insightsPrimitives";

export interface ContextInspectionState {
  category?: AgentModelContextCategory;
  query: string;
  openId?: string;
  changesOnly: boolean;
  /** Only the last opened immutable resource is retained, within this run and endpoint. */
  document?: { key: string; content: string };
}

export function createContextInspectionState(): ContextInspectionState {
  return { query: "", changesOnly: false };
}

export function ContextInspectionView({
  run,
  runs,
  requestId,
  onSelectRequest,
  loading = false,
  scopeId,
  state,
  onStateChange,
}: {
  run: RunRecord | undefined;
  runs?: readonly RunRecord[];
  requestId?: string;
  onSelectRequest: (id: string) => void;
  loading?: boolean;
  scopeId?: string;
  state: ContextInspectionState;
  onStateChange: (patch: Partial<ContextInspectionState>) => void;
}): JSX.Element {
  const requests = useMemo(
    () => (runs ? runs.flatMap((item) => modelRequests(item, scopeId)) : modelRequests(run, scopeId)),
    [runs, run, scopeId],
  );
  const { category, query, openId, changesOnly } = state;
  const search = useDeferredValue(query.trim().toLocaleLowerCase());
  const selected = requestId === undefined ? requests.at(-1) : requests.find((step) => step.id === requestId);
  const snapshot = selected?.contextSnapshot;
  const selectedIndex = requests.findIndex((step) => step.id === selected?.id);
  const previousRequest = requests
    .slice(0, selectedIndex)
    .filter((step) => inspectionScopeId(step.scope) === inspectionScopeId(selected?.scope))
    .at(-1);
  const previous = previousRequest?.contextSnapshot;
  const changes = useMemo(() => (snapshot ? contextChanges(snapshot, previous) : undefined), [snapshot, previous]);
  const usageChange = useMemo(
    () => (selected ? requestContextUsageDelta(selected, previousRequest) : undefined),
    [selected, previousRequest],
  );
  const trendRef = useRef<HTMLDivElement>(null);
  const selectedBarRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const trend = trendRef.current;
    const bar = selectedBarRef.current;
    if (!trend || !bar) return;
    const bounds = trend.getBoundingClientRect();
    const selectedBounds = bar.getBoundingClientRect();
    trend.scrollLeft += selectedBounds.left - bounds.left - (bounds.width - selectedBounds.width) / 2;
  }, [selected?.id, requests.length]);
  const composition = useMemo(() => (snapshot ? contextComposition(snapshot) : []), [snapshot]);
  const usage = selected ? requestContextUsage(selected) : undefined;
  const used = usage?.tokens;
  const window = snapshot?.contextWindow;
  const percent = used !== undefined && window ? (used / window) * 100 : undefined;
  const compositionTokens = snapshot?.estimatedTokens ?? 0;
  const compositionCapacity = snapshot
    ? Math.max((used ?? compositionTokens) + snapshot.reserveTokens, snapshot.contextWindow, 1)
    : 1;
  const compositionScale = compositionTokens > 0 ? (used ?? compositionTokens) / compositionTokens : 0;
  const matching = useMemo(
    () =>
      snapshot?.sections
        .map((section, index) => ({ section, index }))
        .filter(({ section, index }) => {
          const { label } = ContextCategoryPresentation[section.category];
          return (
            (!category || section.category === category) &&
            (!changesOnly || !changes || changes.added.has(index)) &&
            `${section.label} ${t(label)}`.toLocaleLowerCase().includes(search)
          );
        }),
    [snapshot, category, changesOnly, changes, search],
  );
  const maximum = useMemo(
    () => requests.reduce((maximum, step) => Math.max(maximum, requestContextUsage(step)?.tokens ?? 0), 1),
    [requests],
  );

  return (
    <div className="insights-page" data-context-inspection>
      <section className="insights-section">
        <div className="insights-section-title">
          <h3>{t("insights.context.title")}</h3>
          <span>{[selected?.scope?.agentName, selected?.modelName].filter(Boolean).join(" · ")}</span>
        </div>
        <div className="insights-context-total">
          <strong>{used === undefined ? "—" : formatInteger(used)}</strong>
          <span>{window ? `/ ${formatInteger(window)} tokens` : t("insights.context.noSnapshot")}</span>
          <b>{percent === undefined ? "—" : `${percent.toFixed(1)}%`}</b>
        </div>
        {used !== undefined ? (
          <p className="insights-note">
            {t(usage?.source === "provider" ? "insights.context.reported" : "insights.context.estimated")}
          </p>
        ) : null}
        {snapshot ? (
          <>
            <div className="insights-composition" role="img" aria-label={t("insights.context.composition")}>
              {composition.map((part) => (
                <span
                  key={part.id}
                  data-category={part.id}
                  style={{ width: `${((part.tokens * compositionScale) / compositionCapacity) * 100}%` }}
                />
              ))}
              <span className="insights-context-free" style={{ flexGrow: 1 }} />
              <span
                className="insights-context-reserve"
                style={{ width: `${(snapshot.reserveTokens / compositionCapacity) * 100}%` }}
              />
            </div>
            <div className="insights-composition-legend">
              {composition
                .filter((part) => part.count > 0)
                .map((part) => (
                  <button
                    key={part.id}
                    type="button"
                    data-category={part.id}
                    aria-pressed={category === part.id}
                    onClick={() => onStateChange({ category: category === part.id ? undefined : part.id })}
                  >
                    <i />
                    <span>{t(part.label)}</span>
                    <b>≈{formatInteger(part.tokens)}</b>
                  </button>
                ))}
            </div>
            <p className="insights-note">
              {t("insights.context.reserve", { tokens: formatInteger(snapshot.reserveTokens) })}
            </p>
            {snapshot.scope === "baml-input" ? <p className="insights-note">{t("insights.context.baml")}</p> : null}
          </>
        ) : null}
      </section>

      <section className="insights-section">
        <InsightsSectionTitle
          title={t("insights.context.trend")}
          count={requests.length}
          countLabel={t("insights.context.requests", { count: requests.length })}
        />
        <div ref={trendRef} className="insights-request-trend" aria-label={t("insights.context.trend")}>
          {requests.map((step, index) => {
            const parts = step.contextSnapshot ? contextComposition(step.contextSnapshot) : undefined;
            const requestUsage = requestContextUsage(step);
            const value = requestUsage?.tokens;
            const label = t("insights.context.request", { index: index + 1 });
            return (
              <Tooltip
                key={step.id}
                content={
                  <>
                    {label} ·{" "}
                    {value === undefined
                      ? "—"
                      : `${requestUsage?.source === "local_estimate" ? "≈" : ""}${formatInteger(value)}`}
                    <br />
                    {[step.scope?.agentName, step.modelName].filter(Boolean).join(" · ")}
                  </>
                }
              >
                <button
                  ref={step.id === selected?.id ? selectedBarRef : undefined}
                  type="button"
                  aria-label={label}
                  aria-pressed={step.id === selected?.id}
                  onClick={() => onSelectRequest(step.id)}
                >
                  <span
                    className="insights-trend-bar"
                    style={{ height: value === undefined ? "2px" : `${Math.max(2, (value / maximum) * 100)}%` }}
                    data-unknown={!parts || undefined}
                  >
                    {parts
                      ?.filter((part) => part.tokens > 0)
                      .map((part) => (
                        <i key={part.id} data-category={part.id} style={{ flexGrow: part.tokens }} />
                      ))}
                  </span>
                  <small>{index + 1}</small>
                </button>
              </Tooltip>
            );
          })}
        </div>
        <p className="insights-note">{t("insights.context.trendNote")}</p>
        <MenuSelect
          value={selected?.id ?? ""}
          placeholder={t("insights.context.noRequests")}
          options={requests.map((step, index) => ({
            value: step.id,
            label: t("insights.context.request", { index: index + 1 }),
            description: [step.scope?.agentName, step.modelName].filter(Boolean).join(" · "),
          }))}
          onChange={onSelectRequest}
          ariaLabel={t("insights.context.selectRequest")}
          triggerClassName="w-full"
        />
        {selected?.modelUsage ? (
          <dl className="insights-facts">
            <UsageFact label={t("insights.context.input")} value={providerReportedRequestContextTokens(selected)} />
            <UsageFact label={t("insights.context.output")} value={selected.modelUsage.outputTokens} />
            <UsageFact label={t("insights.context.cacheRead")} value={selected.modelUsage.cacheReadTokens} />
            <UsageFact label={t("insights.context.cacheWrite")} value={selected.modelUsage.cacheWriteTokens} />
          </dl>
        ) : null}
        {changes ? (
          <p className="insights-note insights-request-changes">
            {t("insights.context.changes", {
              added: changes.added.size,
              removed: changes.removed,
            })}
            {usageChange
              ? ` · ${t(
                  usageChange.source === "provider"
                    ? "insights.context.changeReported"
                    : "insights.context.changeEstimated",
                  { delta: `${usageChange.tokens >= 0 ? "+" : "−"}${formatInteger(Math.abs(usageChange.tokens))}` },
                )}`
              : null}
          </p>
        ) : null}
      </section>

      <section className="insights-section insights-context-browser">
        <InsightsSectionTitle title={t("insights.context.browser")} count={matching?.length ?? 0} />
        <div className="insights-context-filters">
          <Input
            size="sm"
            value={query}
            onChange={(event) => onStateChange({ query: event.target.value })}
            placeholder={t("insights.context.search")}
            aria-label={t("insights.context.search")}
          />
          {changes ? (
            <MenuSelect
              size="md"
              value={changesOnly ? "added" : "all"}
              onChange={(value) => onStateChange({ changesOnly: value === "added" })}
              ariaLabel={t("insights.context.changeFilter")}
              placeholder={t("insights.context.allContent")}
              options={[
                { value: "all", label: t("insights.context.allContent") },
                { value: "added", label: t("insights.context.addedContent") },
              ]}
            />
          ) : null}
        </div>
        {category ? (
          <Button variant="ghost" size="sm" onClick={() => onStateChange({ category: undefined })}>
            {t("insights.context.clearFilter")}
          </Button>
        ) : null}
        {!snapshot ? (
          <p className="insights-empty">
            {t(
              loading
                ? "insights.historyLoading"
                : requests.length === 0
                  ? "insights.context.noRequests"
                  : "insights.context.historyUnavailable",
            )}
          </p>
        ) : null}
        {snapshot && matching && matching.length > 0 ? (
          <div className="insights-context-list">
            <Virtuoso
              data={matching ?? []}
              computeItemKey={(_index, entry) => `${selected?.id}:${entry.index}:${entry.section.id}`}
              itemContent={(_itemIndex, { section, index }) => {
                const id = `${selected?.id}:${index}:${section.id}`;
                const { label, icon } = ContextCategoryPresentation[section.category];
                const tool =
                  section.category === "tools" || section.category === "toolCall" || section.category === "toolResult";
                const open = openId === id;
                return (
                  <div key={id} className="insights-context-entry" data-category={section.category}>
                    <button
                      type="button"
                      className="insights-content-row"
                      aria-expanded={open}
                      onClick={() => onStateChange({ openId: open ? undefined : id })}
                    >
                      <AppIcon icon="chevron-right" size={12} className={open ? "rotate-90" : undefined} />
                      <span className="insights-entry-position">{index + 1}</span>
                      <AppIcon icon={icon} size={13} className="insights-context-category-icon" />
                      <span className="insights-context-entry-label">
                        <b>{t(label)}</b>
                        {tool ? <small title={section.label}>{section.label}</small> : null}
                        {section.images > 0 ? (
                          <small>{t("insights.context.images", { count: section.images })}</small>
                        ) : null}
                      </span>
                      {changes?.added.has(index) ? (
                        <span className="insights-entry-new">{t("insights.context.added")}</span>
                      ) : null}
                      <span className="insights-entry-tokens">≈{formatInteger(section.tokens)}</span>
                      {section.isError ? <AppIcon icon="alert-circle" size={12} /> : null}
                    </button>
                    {open ? (
                      <ContextSectionContent
                        key={id}
                        section={section}
                        document={state.document}
                        onLoaded={(document) => onStateChange({ document })}
                      />
                    ) : null}
                  </div>
                );
              }}
            />
          </div>
        ) : null}
        {snapshot && matching?.length === 0 ? <p className="insights-note">{t("insights.context.noMatches")}</p> : null}
      </section>
    </div>
  );
}

function UsageFact({ label, value }: { label: string; value: number | undefined }): JSX.Element {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value === undefined ? "—" : formatInteger(value)}</dd>
    </div>
  );
}

function ContextSectionContent({
  section,
  document,
  onLoaded,
}: {
  section: AgentModelContextSection;
  document: ContextInspectionState["document"];
  onLoaded: (document: NonNullable<ContextInspectionState["document"]>) => void;
}): JSX.Element {
  const controller = useWorkspaceResourceController();
  const [failure, setFailure] = useState<{ key: string; message: string }>();
  const [attempt, setAttempt] = useState(0);
  const { copyText, copied } = useClipboardCopy();
  const base = controller?.httpBaseUrl;
  const key = JSON.stringify([base, section.resourceUri]);
  const content = document?.key === key ? document.content : undefined;
  const error = failure?.key === key ? failure.message : undefined;
  const saveDocument = useEffectEvent((content: string) => onLoaded({ key, content }));
  useEffect(() => {
    if (!base || !section.resourceUri || content !== undefined) return;
    const abort = new AbortController();
    void readWorkspaceResource(base, section.resourceUri, { signal: abort.signal })
      .then((value) => {
        if (value.content === undefined) throw new Error(t("insights.context.contentUnavailable"));
        if (!abort.signal.aborted) saveDocument(value.content);
      })
      .catch((cause: unknown) => {
        if (!abort.signal.aborted) setFailure({ key, message: cause instanceof Error ? cause.message : String(cause) });
      });
    return () => abort.abort();
  }, [base, section.resourceUri, attempt, key, content]);
  if (error)
    return (
      <InlineError
        onRetry={() => {
          setFailure(undefined);
          setAttempt((value) => value + 1);
        }}
      >
        {error}
      </InlineError>
    );
  if (!section.resourceUri || !base)
    return <p className="insights-note">{section.contentError ?? t("insights.context.contentUnavailable")}</p>;
  return content === undefined ? (
    <div className="insights-loading">
      <Spinner size="xs" />
      {frontendMessage("ui.loading")}
    </div>
  ) : (
    <div className="insights-context-document">
      <div className="insights-document-actions">
        <IconButton
          label={t("insights.context.copyContent")}
          tooltip={t("insights.context.copyContent")}
          size="sm"
          tone="muted"
          onClick={() => void copyText(content)}
        >
          <AppIcon icon={copied ? "check" : "copy"} size={14} />
        </IconButton>
        <IconButton
          label={t("insights.context.openContent")}
          tooltip={t("insights.context.openContent")}
          size="sm"
          tone="muted"
          onClick={() => controller?.openResource({ path: section.resourceUri! })}
        >
          <AppIcon icon="external-link" size={14} />
        </IconButton>
      </div>
      <pre className="insights-context-content">{content}</pre>
    </div>
  );
}
