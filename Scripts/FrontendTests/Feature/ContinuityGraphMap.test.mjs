import React from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { renderWithFrontendProviders } from "../renderWithFrontendProviders.mjs";
import { ContinuityGraphMap } from "../../../Frontend/src/features/continuity/ContinuityGraphMap.tsx";

beforeEach(() => {
  vi.stubGlobal("requestAnimationFrame", (callback) => window.setTimeout(() => callback(performance.now()), 0));
  vi.stubGlobal("cancelAnimationFrame", (id) => window.clearTimeout(id));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test("continuity graph map renders the authoritative graph projection", async () => {
  const onEntitySelect = vi.fn();
  renderWithFrontendProviders(
    React.createElement(ContinuityGraphMap, {
      graph: {
        scope: [{ kind: "workspace", id: "workspace" }],
        entities: [
          entity("senera://continuity-concept/match", "周末球赛", ["球赛"]),
          entity("senera://continuity-concept/saturday", "下周六"),
          entity("senera://continuity-concept/weather", "天气"),
        ],
        relations: [
          relation({
            uri: "senera://continuity-relation/schedule",
            relationId: "scheduled_for",
            relationLabel: "安排在",
            subjectUri: "senera://continuity-concept/match",
            objectUri: "senera://continuity-concept/saturday",
          }),
          relation({
            uri: "senera://continuity-relation/weather",
            relationId: "depends_on",
            relationLabel: "依赖",
            subjectUri: "senera://continuity-concept/match",
            objectUri: "senera://continuity-concept/weather",
            maturity: "candidate",
          }),
        ],
      },
      promptRelations: [{ subject: "周末球赛", relationId: "scheduled_for", object: "下周六" }],
      anchorLabels: ["球赛"],
      onEntitySelect,
    }),
  );

  expect(await screen.findByTestId("continuity-graph-map")).toBeVisible();
  expect(screen.getByText("周末球赛")).toBeInTheDocument();
  expect(screen.getByText("下周六")).toBeInTheDocument();
  expect(screen.getByText("天气")).toBeInTheDocument();
  expect(document.querySelectorAll("[data-continuity-graph-node]")).toHaveLength(3);
  expect(document.querySelector('[data-continuity-graph-anchored="true"]')).toHaveTextContent("周末球赛");
  fireEvent.click(screen.getByText("周末球赛"));
  expect(onEntitySelect).toHaveBeenCalledWith("senera://continuity-concept/match");
});

function entity(uri, label, aliases = []) {
  return {
    uri,
    label,
    aliases,
    kind: "concept",
    scope: { kind: "workspace", id: "workspace" },
    status: "active",
    mergedIntoUri: null,
    createdAt: "2026-08-28T00:00:00.000Z",
    updatedAt: "2026-08-28T00:00:00.000Z",
  };
}

function relation({ uri, relationId, relationLabel, subjectUri, objectUri, maturity = "active" }) {
  return {
    id: uri.slice(uri.lastIndexOf("/") + 1),
    uri,
    subjectUri,
    relationId,
    relationLabel,
    objectUri,
    scope: { kind: "workspace", id: "workspace" },
    cardinality: "many_to_many",
    temporal: { kind: "persistent", timeZone: "Asia/Shanghai" },
    authority: "user_explicit",
    confidence: 0.9,
    sourceRefs: ["senera://memory-source/source"],
    supportCount: 1,
    supportMass: 0.9,
    maturity,
    status: "active",
    supersededBy: null,
    createdAt: "2026-08-28T00:00:00.000Z",
    updatedAt: "2026-08-28T00:00:00.000Z",
  };
}
