import { expect, test } from "vitest";
import { projectContinuityGraph } from "../../../Frontend/src/features/continuity/continuityGraphProjection.ts";

test("continuity graph projection prioritizes prompt context without hiding candidate evidence", () => {
  const projection = projectContinuityGraph({
    graph: graphFixture({
      relations: [
        relation({
          uri: "senera://continuity-relation/weather",
          relationId: "depends_on",
          relationLabel: "依赖",
          subjectUri: "senera://continuity-concept/match",
          objectUri: "senera://continuity-concept/weather",
          maturity: "candidate",
          supportMass: 0.98,
        }),
        relation({
          uri: "senera://continuity-relation/schedule",
          relationId: "scheduled_for",
          relationLabel: "安排在",
          subjectUri: "senera://continuity-concept/match",
          objectUri: "senera://continuity-concept/saturday",
          maturity: "active",
          supportMass: 0.6,
        }),
        relation({
          uri: "senera://continuity-relation/retracted",
          relationId: "about",
          relationLabel: "关于",
          subjectUri: "senera://continuity-concept/match",
          objectUri: "senera://continuity-concept/project",
          status: "superseded",
        }),
      ],
    }),
    promptRelations: [{ subject: "周末球赛", relationId: "scheduled_for", object: "下周六" }],
    anchorLabels: ["周末球赛"],
  });

  expect(projection.edges.map((edge) => edge.id)).toEqual([
    "senera://continuity-relation/schedule",
    "senera://continuity-relation/weather",
  ]);
  expect(projection.edges[0].data.selectedForPrompt).toBe(true);
  expect(projection.edges[1].data.maturity).toBe("candidate");
  expect(projection.edges[1].style.strokeDasharray).toBe("4 3");
  expect(projection.nodes.find((node) => node.id === "senera://continuity-concept/match").data.anchored).toBe(true);
  expect(projection.nodes.every((node) => Number.isFinite(node.position.x) && Number.isFinite(node.position.y))).toBe(
    true,
  );
});

test("continuity graph projection enforces a bounded visual subgraph", () => {
  const projection = projectContinuityGraph({
    graph: graphFixture({
      entities: [
        entity("senera://continuity-concept/a", "甲"),
        entity("senera://continuity-concept/b", "乙"),
        entity("senera://continuity-concept/c", "丙"),
        entity("senera://continuity-concept/d", "丁"),
      ],
      relations: [
        relation({
          uri: "senera://continuity-relation/a-b",
          subjectUri: "senera://continuity-concept/a",
          objectUri: "senera://continuity-concept/b",
          supportMass: 1,
        }),
        relation({
          uri: "senera://continuity-relation/c-d",
          subjectUri: "senera://continuity-concept/c",
          objectUri: "senera://continuity-concept/d",
          supportMass: 0.9,
        }),
      ],
    }),
    policy: {
      maxRelations: 3,
      maxEntities: 3,
      nodeWidth: 164,
      nodeHeight: 58,
      nodeSeparation: 26,
      rankSeparation: 72,
    },
  });

  expect(projection.entityCount).toBe(2);
  expect(projection.relationCount).toBe(1);
  expect(projection.edges.map((edge) => edge.id)).toEqual(["senera://continuity-relation/a-b"]);
});

test("continuity graph projection rejects an invalid visual policy", () => {
  expect(() =>
    projectContinuityGraph({
      graph: graphFixture(),
      policy: {
        maxRelations: 1.5,
        maxEntities: 2,
        nodeWidth: 164,
        nodeHeight: 58,
        nodeSeparation: 26,
        rankSeparation: 72,
      },
    }),
  ).toThrow("maxRelations must be a positive safe integer");
});

test("continuity graph projection focuses the current turn without inventing paths", () => {
  const projection = projectContinuityGraph({
    graph: graphFixture({
      entities: [
        entity("senera://continuity-concept/match", "周末球赛", ["球赛"]),
        entity("senera://continuity-concept/saturday", "下周六"),
        entity("senera://continuity-concept/weather", "天气"),
        entity("senera://continuity-concept/project", "另一个项目"),
        entity("senera://continuity-concept/owner", "项目负责人"),
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
        }),
        relation({
          uri: "senera://continuity-relation/unrelated",
          relationId: "about",
          relationLabel: "关于",
          subjectUri: "senera://continuity-concept/project",
          objectUri: "senera://continuity-concept/owner",
        }),
      ],
    }),
    promptRelations: [{ subject: "周末球赛", relationId: "scheduled_for", object: "下周六" }],
    anchorLabels: ["周末球赛"],
    relationMode: "focus",
    selectedEntityUri: "senera://continuity-concept/match",
  });

  expect(projection.edges.map((edge) => edge.id)).toEqual([
    "senera://continuity-relation/schedule",
    "senera://continuity-relation/weather",
  ]);
  expect(projection.nodes.find((node) => node.id === "senera://continuity-concept/match").data.selected).toBe(true);
  expect(projection.nodes.find((node) => node.id === "senera://continuity-concept/project")).toBeUndefined();
});

function graphFixture(overrides = {}) {
  return {
    scope: [{ kind: "workspace", id: "workspace" }],
    entities: [
      entity("senera://continuity-concept/match", "周末球赛", ["球赛"]),
      entity("senera://continuity-concept/weather", "天气"),
      entity("senera://continuity-concept/saturday", "下周六"),
      entity("senera://continuity-concept/project", "项目"),
    ],
    relations: [],
    ...overrides,
  };
}

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

function relation({
  uri,
  relationId = "about",
  relationLabel = "关于",
  subjectUri,
  objectUri,
  maturity = "active",
  status = "active",
  supportMass = 0.5,
}) {
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
    supportMass,
    maturity,
    status,
    supersededBy: status === "active" ? null : "senera://continuity-relation/newer",
    createdAt: "2026-08-28T00:00:00.000Z",
    updatedAt: "2026-08-28T00:00:00.000Z",
  };
}
