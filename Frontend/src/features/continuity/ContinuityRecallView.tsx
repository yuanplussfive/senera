import { lazy, Suspense, useMemo, useState } from "react";
import { ChevronDown, GitBranch } from "lucide-react";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { formatDateTime } from "../../lib/util";
import type { RunRecord } from "../../store/sessionStore";
import { ContinuityEmptyText, formatContinuityConfidence } from "./ContinuityPanelPrimitives";
import { ContinuityFactCatalog } from "./ContinuityFactCatalog";
import { ContinuityRecallInspector } from "./ContinuityRecallInspector";

type ContinuityGraph = NonNullable<NonNullable<RunRecord["continuity"]>["graph"]>;
type ContinuityGraphEntity = ContinuityGraph["entities"][number];
type ContinuityGraphRelation = ContinuityGraph["relations"][number];

const LazyContinuityGraphMap = lazy(() =>
  import("./ContinuityGraphMap").then((module) => ({ default: module.ContinuityGraphMap })),
);

export function ContinuityRecallView({ run }: { run: RunRecord }): JSX.Element {
  const continuity = run.continuity;
  if (!continuity) throw new Error("Continuity recall view requires a turn snapshot.");
  const [selectedEntityUri, setSelectedEntityUri] = useState<string | undefined>();

  return (
    <section className="space-y-4 px-4 py-4" data-continuity-knowledge>
      <header className="border-b border-line-subtle pb-3">
        <p className="text-[9px] font-medium uppercase tracking-[0.12em] text-accent-content">
          {frontendMessage("continuity.tab.knowledge")}
        </p>
        <div className="mt-1 flex min-w-0 items-baseline justify-between gap-3">
          <h3 className="min-w-0 truncate text-[15px] font-medium leading-6 text-content-primary">
            {frontendMessage("continuity.knowledge.title")}
          </h3>
          <span className="shrink-0 text-[9px] tabular-nums text-content-muted">
            {continuity.selection.usedCharacters} / {continuity.selection.maxCharacters} ch
          </span>
        </div>
        <p className="mt-1 text-[10.5px] leading-5 text-content-secondary">
          {frontendMessage("continuity.knowledge.summary", {
            used: continuity.selection.usedCharacters,
            maximum: continuity.selection.maxCharacters,
          })}
        </p>
      </header>

      <ContinuityFactCatalog continuity={continuity} />
      <GraphRelations
        continuity={continuity}
        run={run}
        selectedEntityUri={selectedEntityUri}
        onEntitySelect={setSelectedEntityUri}
      />
      <ContinuityRecallInspector run={run} />
    </section>
  );
}

function GraphRelations({
  continuity,
  run,
  selectedEntityUri,
  onEntitySelect,
}: {
  continuity: NonNullable<RunRecord["continuity"]>;
  run: RunRecord;
  selectedEntityUri: string | undefined;
  onEntitySelect: (entityUri: string | undefined) => void;
}): JSX.Element | null {
  const graph = continuity.graph;
  if (!graph) return null;

  return (
    <details className="group border-y border-line-subtle" aria-labelledby="continuity-graph-workspace">
      <summary className="flex min-h-10 cursor-pointer list-none items-center gap-2 [&::-webkit-details-marker]:hidden">
        <GitBranch className="h-3.5 w-3.5 shrink-0 text-content-muted" aria-hidden="true" />
        <span
          id="continuity-graph-workspace"
          className="min-w-0 flex-1 text-[10.5px] font-medium text-content-secondary"
        >
          {frontendMessage("continuity.graphRelations")}
        </span>
        <span className="shrink-0 text-[9px] tabular-nums text-content-muted">
          {frontendMessage("continuity.graphMapSummary", {
            entities: graph.entities.length,
            relations: graph.relations.length,
          })}
        </span>
        <ChevronDown
          className="h-3.5 w-3.5 shrink-0 text-content-muted transition-transform group-open:rotate-180"
          aria-hidden="true"
        />
      </summary>
      <div className="space-y-3 border-t border-line-subtle py-3">
        {graph.relations.length === 0 ? (
          <ContinuityEmptyText>{frontendMessage("continuity.emptyGraphRelations")}</ContinuityEmptyText>
        ) : (
          <>
            <Suspense fallback={<div className="h-72 border border-line-subtle bg-surface-subtle" aria-busy="true" />}>
              <LazyContinuityGraphMap
                graph={graph}
                promptRelations={continuity.graphRelations}
                anchorLabels={run.recall?.local?.anchorLabels}
                selectedEntityUri={selectedEntityUri}
                onEntitySelect={onEntitySelect}
              />
            </Suspense>
            <GraphFocus graph={graph} selectedEntityUri={selectedEntityUri} />
            <RelationLedger graph={graph} />
          </>
        )}
      </div>
    </details>
  );
}

function GraphFocus({
  graph,
  selectedEntityUri,
}: {
  graph: ContinuityGraph;
  selectedEntityUri: string | undefined;
}): JSX.Element {
  const focus = useMemo(() => {
    const entities = new Map(graph.entities.map((entity) => [entity.uri, entity] as const));
    const entity = selectedEntityUri ? entities.get(selectedEntityUri) : undefined;
    const relations = entity
      ? graph.relations.filter(
          (relation) =>
            relation.status === "active" && (relation.subjectUri === entity.uri || relation.objectUri === entity.uri),
        )
      : [];
    return { entities, entity, relations };
  }, [graph, selectedEntityUri]);

  if (!focus.entity) {
    return (
      <div className="border-l-2 border-line-strong px-2.5 py-0.5 text-[10.5px] leading-5 text-content-muted">
        {frontendMessage("continuity.graph.selectEntity")}
      </div>
    );
  }

  return (
    <section className="border-l-2 border-accent-border px-2.5 py-0.5" data-continuity-graph-focus={focus.entity.uri}>
      <div className="flex min-w-0 items-baseline gap-2">
        <h5 className="min-w-0 flex-1 truncate text-[11.5px] font-medium leading-5 text-content-primary">
          {focus.entity.label}
        </h5>
        <span className="shrink-0 text-[9.5px] tabular-nums leading-4 text-content-muted">
          {frontendMessage("continuity.graph.entityConnections", { count: focus.relations.length })}
        </span>
      </div>
      <ul className="mt-1.5 space-y-1.5">
        {focus.relations.map((relation) => {
          const otherUri = relation.subjectUri === focus.entity?.uri ? relation.objectUri : relation.subjectUri;
          const other = requireGraphEntity(focus.entities, otherUri);
          return (
            <li key={relation.uri} className="min-w-0 text-[10.5px] leading-5 text-content-secondary">
              <span className="text-content-muted">{relation.relationLabel}</span>
              <span className="px-1 text-content-disabled">/</span>
              <span className="font-medium text-content-primary">{other.label}</span>
              <span className="pl-1.5 text-[9.5px] tabular-nums text-content-muted">
                {formatContinuityConfidence(relation.supportMass)}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function RelationLedger({ graph }: { graph: ContinuityGraph }): JSX.Element {
  const entities = new Map(graph.entities.map((entity) => [entity.uri, entity] as const));
  return (
    <details className="group border-t border-line-subtle pt-2.5">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[10px] font-medium leading-5 text-content-secondary [&::-webkit-details-marker]:hidden">
        <span className="min-w-0 flex-1">{frontendMessage("continuity.graph.relationLedger")}</span>
        <ChevronDown
          className="h-3.5 w-3.5 shrink-0 text-content-muted transition-transform group-open:rotate-180"
          aria-hidden="true"
        />
      </summary>
      <ul className="mt-2 space-y-2">
        {graph.relations.map((relation) => {
          const subject = requireGraphEntity(entities, relation.subjectUri);
          const object = requireGraphEntity(entities, relation.objectUri);
          return (
            <li key={relation.uri} className="min-w-0 border-l border-line-strong pl-2">
              <p className="break-words text-[10.5px] leading-5 text-content-secondary">
                <span>{subject.label}</span>
                <span className="px-1 text-content-muted">{relation.relationLabel}</span>
                <span>{object.label}</span>
              </p>
              <p className="text-[9.5px] leading-4 text-content-disabled">
                {frontendMessage("continuity.graphRelationEvidence", {
                  count: relation.supportCount,
                  mass: formatContinuityConfidence(relation.supportMass),
                })}
                <span aria-hidden="true"> / </span>
                {frontendMessage(`continuity.maturity.${relation.maturity}` as const)}
              </p>
              <GraphRelationTiming relation={relation} />
            </li>
          );
        })}
      </ul>
    </details>
  );
}

function requireGraphEntity(entities: ReadonlyMap<string, ContinuityGraphEntity>, uri: string): ContinuityGraphEntity {
  const entity = entities.get(uri);
  if (!entity) throw new Error(`Continuity graph relation references a missing entity: ${uri}`);
  return entity;
}

function GraphRelationTiming({ relation }: { relation: ContinuityGraphRelation }): JSX.Element | null {
  const startsAt = relation.temporal.startsAt;
  const endsAt = relation.temporal.endsAt;
  if (!startsAt && !endsAt) return null;
  return (
    <p className="text-[9.5px] leading-4 text-content-disabled">
      {frontendMessage("continuity.graphRelationTime", {
        start: startsAt ? formatDateTime(startsAt) : frontendMessage("continuity.graphRelationOpenTime"),
        end: endsAt ? formatDateTime(endsAt) : frontendMessage("continuity.graphRelationOpenTime"),
      })}
    </p>
  );
}
