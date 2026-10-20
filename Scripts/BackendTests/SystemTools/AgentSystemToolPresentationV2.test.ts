import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import type { z } from "zod";
import { AgentSystemToolContractSchema } from "../../../Source/AgentSystem/SystemTools/AgentSystemExtensionManifest.js";
import {
  AgentSystemToolPresentationOverrideSchema,
  AgentSystemToolPresentationSchema,
  AgentToolPresentationActivityV2Schema,
  AgentToolPresentationEnvironmentPointers,
  inspectAgentToolPresentationFactReferences,
  resolveAgentSystemToolPresentation,
} from "../../../Source/AgentSystem/SystemTools/AgentSystemToolPresentation.js";
import type {
  AgentToolPresentation,
  AgentToolPresentationActivityV2,
  AgentToolPresentationOverride,
} from "../../../Source/AgentSystem/Types/AgentToolPresentationTypes.js";

type InferredActivityV2 = z.infer<typeof AgentToolPresentationActivityV2Schema>;

/**
 * Compile-time drift gate: whatever the schema parses must satisfy the
 * hand-written interface that the frontend consumes. A field added to one
 * side only breaks `tsc`, not a render.
 */
const asDeclaredActivityV2 = (value: InferredActivityV2): AgentToolPresentationActivityV2 => value;

function measure(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { id: "value", from: "argument", pointer: "/operations", field: "path", ...overrides };
}

function rejectionMessages(value: unknown): readonly string[] {
  const parsed = AgentToolPresentationActivityV2Schema.safeParse(value);
  expect(parsed.success, `expected rejection, received ${JSON.stringify(parsed)}`).toBe(false);
  return parsed.success ? [] : parsed.error.issues.map((issue) => issue.message);
}

function acceptance(value: unknown): InferredActivityV2 {
  const parsed = AgentToolPresentationActivityV2Schema.safeParse(value);
  expect(parsed.success ? [] : parsed.error.issues).toEqual([]);
  return parsed.data as InferredActivityV2;
}

function presentation(overrides: AgentToolPresentationOverride = {}): AgentToolPresentationOverride {
  return overrides;
}

function domainPresentation(): AgentToolPresentation {
  return {
    category: "workspace-patch",
    icon: "pencil",
    group: { id: "workspace", title: { "zh-CN": "工作区", "en-US": "Workspace" } },
    activity: { action: { "zh-CN": "应用补丁", "en-US": "Apply patch" } },
  };
}

/** The exact block from the P2 design, kept verbatim so the design cannot drift. */
const workspacePatchV2 = {
  measures: [
    {
      id: "operationKind",
      from: "argument",
      pointer: "/operations",
      field: "kind",
      aggregate: "first",
      type: "enum",
      labels: {
        add: { "zh-CN": "新增文件", "en-US": "Create file" },
        update: { "zh-CN": "编辑文件", "en-US": "Edit file" },
        write: { "zh-CN": "覆写文件", "en-US": "Overwrite file" },
        delete: { "zh-CN": "删除文件", "en-US": "Delete file" },
        move: { "zh-CN": "移动文件", "en-US": "Move file" },
      },
    },
    { id: "operationCount", from: "argument", pointer: "/operations", aggregate: "count", type: "number" },
    { id: "primaryPath", from: "argument", pointer: "/operations", field: "path", aggregate: "first", type: "path" },
    { id: "moveSource", from: "argument", pointer: "/operations", field: "source", aggregate: "first", type: "path" },
    {
      id: "moveDestination",
      from: "argument",
      pointer: "/operations",
      field: "destination",
      aggregate: "first",
      type: "path",
    },
    {
      id: "changedFiles",
      from: "result",
      pointer: "/changes",
      field: "key",
      where: { field: "kind", equals: "workspace" },
      aggregate: "count",
      type: "number",
    },
    {
      id: "addedLines",
      from: "result",
      pointer: "/changes",
      field: "addedLines",
      where: { field: "kind", equals: "workspace" },
      aggregate: "sum",
      type: "delta",
      sign: "always",
    },
    {
      id: "removedLines",
      from: "result",
      pointer: "/changes",
      field: "removedLines",
      where: { field: "kind", equals: "workspace" },
      aggregate: "sum",
      type: "delta",
      sign: "negative-only",
    },
  ],
  variants: [
    {
      id: "singleMove",
      when: { measure: "operationKind", equals: "move" },
      title: "移动文件 {{moveSource}} → {{moveDestination}}",
    },
    {
      id: "single",
      when: { measure: "operationCount", equals: 1 },
      title: "{{operationKind}} {{primaryPath}} · {{addedLines}} {{removedLines}}",
    },
    {
      id: "batch",
      title: "应用补丁 · {{operationCount}} 项操作 · {{changedFiles}} 个文件 · {{addedLines}} {{removedLines}}",
    },
  ],
  title: "应用补丁 · {{operationCount}} 项操作",
};

describe("Tool presentation contract v2 schema", () => {
  test("accepts the design's WorkspaceApplyPatch declaration", () => {
    const activity = acceptance(workspacePatchV2);
    expect(activity.measures).toHaveLength(8);
    expect(activity.variants.map((variant) => variant.id)).toEqual(["singleMove", "single", "batch"]);
    // Defaults are applied at parse time, so the frontend never sees `undefined`.
    expect(activity.measures[1]).toMatchObject({ aggregate: "count", type: "number", sign: "never", zero: "omit" });
  });

  test("keeps the parsed shape assignable to the declared TypeScript interface", () => {
    const declared = asDeclaredActivityV2(acceptance(workspacePatchV2));
    expect(declared.variants).toHaveLength(3);
    const literal: AgentToolPresentationActivityV2 = {
      measures: [],
      variants: [],
    };
    expect(acceptance({ ...literal, title: "应用补丁" }).title).toBe("应用补丁");
  });

  test("accepts an empty v2 block", () => {
    expect(acceptance({}).measures).toEqual([]);
  });
});

describe("Tool presentation contract v2 validation", () => {
  test("V1 rejects a template that references an undeclared measure", () => {
    expect(rejectionMessages({ measures: [measure({ id: "addedLines" })], title: "{{addedLine}}" })).toContain(
      'Template references undeclared measure "addedLine".',
    );
    expect(rejectionMessages({ measures: [], variants: [{ id: "only", title: "{{missing}}" }] })).toContain(
      'Template references undeclared measure "missing".',
    );
  });

  test("V1 accepts a template that only references declared measures", () => {
    expect(acceptance({ measures: [measure({ id: "addedLines" })], title: "编辑 · {{addedLines}}" }).title).toBe(
      "编辑 · {{addedLines}}",
    );
  });

  test("V3 rejects duplicate measure ids", () => {
    expect(rejectionMessages({ measures: [measure({ id: "path" }), measure({ id: "path" })] })).toContain(
      'Measure id "path" is declared more than once.',
    );
  });

  test("V4 rejects a variant that branches on an undeclared measure", () => {
    expect(
      rejectionMessages({
        measures: [measure({ id: "operationCount" })],
        variants: [{ id: "a", when: { measure: "count", equals: 1 } }],
      }),
    ).toContain('Variant references undeclared measure "count".');
  });

  test("V5 rejects a second fallback variant and a fallback that is not last", () => {
    expect(rejectionMessages({ variants: [{ id: "a" }, { id: "b" }] })).toContain(
      "At most one variant may omit `when`.",
    );
    expect(
      rejectionMessages({
        measures: [measure({ id: "count" })],
        variants: [{ id: "fallback" }, { id: "specific", when: { measure: "count", equals: 1 } }],
      }),
    ).toContain("The variant without `when` must be the last entry; variants match in array order.");
  });

  test("V5 accepts a single fallback placed last", () => {
    const activity = acceptance({
      measures: [measure({ id: "count" })],
      variants: [{ id: "specific", when: { measure: "count", equals: 1 } }, { id: "fallback" }],
    });
    expect(activity.variants.map((variant) => variant.id)).toEqual(["specific", "fallback"]);
  });

  test("V6 rejects numeric aggregation over a non-numeric type", () => {
    expect(rejectionMessages({ measures: [measure({ aggregate: "sum", type: "text" })] })).toContain(
      'aggregate "sum" requires type "number" or "delta", received "text".',
    );
    expect(rejectionMessages({ measures: [measure({ aggregate: "max", type: "path" })] })).toContain(
      'aggregate "max" requires type "number" or "delta", received "path".',
    );
  });

  test("V6 rejects join without a separator and where without a field", () => {
    expect(rejectionMessages({ measures: [measure({ aggregate: "join", type: "text" })] })).toContain(
      'aggregate "join" requires `separator`.',
    );
    expect(
      rejectionMessages({ measures: [measure({ where: { field: "kind", equals: "workspace" }, field: undefined })] }),
    ).toContain("`where` filters collection entries and requires `field`.");
  });

  test("V6 accepts sum over delta and join with a separator", () => {
    const activity = acceptance({
      measures: [
        measure({ id: "addedLines", aggregate: "sum", type: "delta", sign: "always" }),
        measure({ id: "kinds", aggregate: "join", type: "text", separator: ", " }),
      ],
      title: "{{addedLines}} {{kinds}}",
    });
    expect(activity.measures[0]).toMatchObject({ aggregate: "sum", type: "delta" });
  });

  test("V7 confines env measures to the closed pointer set with no field or where", () => {
    expect(AgentToolPresentationEnvironmentPointers).toEqual(["/status", "/durationMs", "/toolName"]);
    expect(rejectionMessages({ measures: [measure({ from: "env", pointer: "/cwd" })] })).toContain(
      "env measures may only read /status, /durationMs, /toolName.",
    );
    expect(
      rejectionMessages({ measures: [measure({ from: "env", pointer: "/durationMs", field: "value" })] }),
    ).toContain("env measures are scalars and must not declare `field`.");
    expect(
      rejectionMessages({
        measures: [
          measure({ from: "env", pointer: "/durationMs", where: { field: "name", equals: "x" }, field: "value" }),
        ],
      }),
    ).toContain("env measures are scalars and must not declare `where`.");
  });

  test("V7 accepts the declared env pointers", () => {
    const activity = acceptance({
      measures: [
        measure({
          id: "durationMs",
          from: "env",
          pointer: "/durationMs",
          type: "number",
          unit: "ms",
          field: undefined,
        }),
        measure({ id: "toolName", from: "env", pointer: "/toolName", type: "text", field: undefined }),
      ],
      title: "{{toolName}} · {{durationMs}}",
    });
    expect(activity.measures.map((entry) => entry.pointer)).toEqual(["/durationMs", "/toolName"]);
  });

  test("V10 rejects a literal sign adjacent to a placeholder", () => {
    expect(
      rejectionMessages({
        measures: [measure({ id: "addedLines", type: "delta", sign: "always" })],
        title: "编辑 · +{{addedLines}}",
      }),
    ).toContain(
      'Templates must not carry a literal "+"/"−" next to a placeholder; declare `sign` on the measure instead.',
    );
  });

  test("V10 accepts a sign-free template that relies on `sign`", () => {
    const activity = acceptance({
      measures: [measure({ id: "addedLines", type: "delta", sign: "always" })],
      title: "编辑 · {{addedLines}}",
    });
    expect(activity.title).toBe("编辑 · {{addedLines}}");
  });

  test("rejects an unbalanced placeholder", () => {
    expect(rejectionMessages({ measures: [measure({ id: "addedLines" })], title: "编辑 · {{addedLines" })).toContain(
      "Template contains an unbalanced `{{ }}` placeholder.",
    );
  });
});

describe("Tool presentation contract v2 ownership", () => {
  test("V8 rejects v2 declared by both the extension and the tool tier", () => {
    expect(() =>
      resolveAgentSystemToolPresentation(
        domainPresentation(),
        presentation({ activity: { v2: { measures: [], variants: [] } } }),
        presentation({ activity: { v2: { measures: [], variants: [] } } }),
      ),
    ).toThrow("activity.v2 must be declared by exactly one tier (extension or tool).");
  });

  test("V8 accepts v2 declared by exactly one tier", () => {
    const resolved = resolveAgentSystemToolPresentation(
      domainPresentation(),
      presentation({ activity: { v2: { measures: [], variants: [], title: "应用补丁" } } }),
    );
    expect(resolved.activity.v2?.title).toBe("应用补丁");
  });

  test("V8 accepts contracts that declare no v2 at all", () => {
    const resolved = resolveAgentSystemToolPresentation(domainPresentation(), presentation({ category: "patched" }));
    expect(resolved.category).toBe("patched");
    expect(resolved.activity.v2).toBeUndefined();
  });

  test("resolves v2 through the override schema used by *.tool.json", () => {
    const parsed = AgentSystemToolPresentationOverrideSchema.safeParse({ activity: { v2: workspacePatchV2 } });
    expect(parsed.success ? [] : parsed.error.issues).toEqual([]);
    expect(parsed.success ? parsed.data.activity?.v2?.variants.map((variant) => variant.id) : []).toEqual([
      "singleMove",
      "single",
      "batch",
    ]);
  });

  test("rejects unknown v2 keys so a typo cannot be silently dropped", () => {
    const parsed = AgentSystemToolPresentationOverrideSchema.safeParse({
      activity: { v2: { measures: [], variants: [], titles: "typo" } },
    });
    expect(parsed.success).toBe(false);
  });

  test("keeps the resolved presentation schema strict about v2", () => {
    const parsed = AgentSystemToolPresentationSchema.safeParse({
      ...domainPresentation(),
      activity: { ...domainPresentation().activity, v2: { measures: [], variants: [] } },
    });
    expect(parsed.success ? [] : parsed.error.issues).toEqual([]);
  });
});

describe("Tool presentation contract v2 fact references", () => {
  test("V9 rejects a /facts measure whose fact the contract never declares", () => {
    const contract = minimalContract("TestTool");
    contract.presentation = {
      activity: {
        v2: {
          measures: [
            {
              id: "exitCode",
              from: "presentation",
              pointer: "/facts",
              field: "value",
              where: { field: "name", equals: "exitCode" },
              aggregate: "first",
              type: "number",
            },
          ],
          title: "退出码 {{exitCode}}",
        },
      },
    };

    const parsed = AgentSystemToolContractSchema.safeParse(contract);
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.issues.map((issue) => issue.message)).toContain(
      'Measure "exitCode" reads /facts where name = "exitCode", but the contract declares no such Evidence fact or slot.',
    );
  });

  test("V9 accepts a /facts measure once the contract declares the fact", () => {
    const contract = minimalContract("TestTool");
    contract.presentation = {
      activity: {
        v2: {
          measures: [
            {
              id: "exitCode",
              from: "presentation",
              pointer: "/facts",
              field: "value",
              where: { field: "name", equals: "exitCode" },
              aggregate: "first",
              type: "number",
            },
          ],
          title: "退出码 {{exitCode}}",
        },
      },
    };
    contract.artifacts = {
      Evidence: [
        {
          Kind: "command_result",
          Records: "records",
          Slots: { cwd: "cwd" },
          Identity: { Parts: ["command"] },
          Presentation: { Locator: "locator", Display: "display", Label: "label", Source: "source" },
          ModelProjection: { Slots: ["cwd", "exitCode"] },
          PlannerMemory: { Facts: ["cwd", "exitCode"] },
          Projection: { SummaryTemplate: "{{command}}", ArtifactTemplate: "{{command}}" },
          Confidence: 0.9,
        },
      ],
    };

    const parsed = AgentSystemToolContractSchema.safeParse(contract);
    expect(parsed.success ? [] : parsed.error.issues).toEqual([]);
  });

  test("reports every offending measure through the shared assertion", () => {
    const messages = inspectAgentToolPresentationFactReferences(
      acceptance({
        measures: [
          {
            id: "exitCode",
            from: "presentation",
            pointer: "/facts",
            field: "value",
            where: { field: "name", equals: "exitCode" },
          },
          {
            id: "signal",
            from: "presentation",
            pointer: "/facts",
            field: "value",
            where: { field: "name", equals: "signal" },
          },
        ],
      }) as AgentToolPresentationActivityV2,
      ["exitCode"],
    );
    expect(messages).toEqual([
      'Measure "signal" reads /facts where name = "signal", but the contract declares no such Evidence fact or slot.',
    ]);
  });

  test("ignores measures that do not read /facts", () => {
    const messages = inspectAgentToolPresentationFactReferences(
      acceptance({
        measures: [measure({ id: "changedFiles", from: "result", pointer: "/changes", field: "key" })],
      }) as AgentToolPresentationActivityV2,
      [],
    );
    expect(messages).toEqual([]);
  });
});

function minimalContract(name: string): Record<string, unknown> {
  return {
    name,
    loading: "Dynamic",
    description: `${name} test contract.`,
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    outputSchema: { type: "object", properties: {}, additionalProperties: false },
    permissions: [],
    execution: { Targets: ["Local"], Network: "Deny", Workspace: "ReadOnly" },
    runtime: {
      Lifecycle: "Immediate",
      ProtocolVersion: 2,
      ResultAssessment: "ProcessExit",
      Scheduling: "Parallel",
    },
    resources: [],
    sources: [],
    search: {
      Summary: `${name} test tool`,
      Capabilities: [{ Id: `test.${name.toLowerCase()}`, Aliases: [`${name} test`] }],
      UseCases: [`Exercise the ${name} test contract.`],
    },
    evidenceCapabilities: [],
  };
}

/**
 * M2 binding gate: `WorkspaceApplyPatch` declares operation language before a
 * result exists; completed file rows come from the shared workspace change
 * protocol and are tested at the frontend projection boundary.
 */
describe("shipped WorkspaceApplyPatch v2 declaration", () => {
  const contractPath = path.resolve(
    "System",
    "Extensions",
    "change",
    "workspace-patch",
    "tools",
    "WorkspaceApplyPatch.tool.json",
  );

  function readShippedV2(): AgentToolPresentationActivityV2 {
    const parsed = AgentSystemToolContractSchema.safeParse(JSON.parse(readFileSync(contractPath, "utf8")));
    expect(parsed.success ? [] : parsed.error.issues).toEqual([]);
    const v2 = parsed.success ? parsed.data.presentation?.activity?.v2 : undefined;
    expect(v2).toBeDefined();
    return v2 as AgentToolPresentationActivityV2;
  }

  test("declares the measures the renderer reads, in design order", () => {
    expect(readShippedV2().measures.map((entry) => entry.id)).toEqual([
      "operationKind",
      "operationCount",
      "primaryPath",
      "moveSource",
      "moveDestination",
      "changedFiles",
      "addedLines",
      "removedLines",
    ]);
  });

  test("orders singleMove before single and keeps batch as the last fallback", () => {
    const variants = readShippedV2().variants;
    expect(variants.map((entry) => entry.id)).toEqual(["singleMove", "single", "batch"]);
    expect(variants.at(-1)?.when).toBeUndefined();
  });

  test("keeps operation labels compact while standard results supply file rows", () => {
    const v2 = readShippedV2();
    expect(v2.title).toBe("修改 · {{operationCount}} 项操作");
    expect(v2.variants.map((entry) => entry.title)).toEqual([
      "移动 {{moveSource}} → {{moveDestination}}",
      "{{operationKind}} {{primaryPath}} · {{addedLines}} {{removedLines}}",
      "修改 · {{operationCount}} 项 · {{changedFiles}} 个文件 · {{addedLines}} {{removedLines}}",
    ]);
    expect(v2.measures.find((entry) => entry.id === "operationKind")?.labels).toMatchObject({
      add: { "zh-CN": "新增" },
      update: { "zh-CN": "编辑" },
      write: { "zh-CN": "覆写" },
      delete: { "zh-CN": "删除" },
      move: { "zh-CN": "移动" },
    });
  });

  test("parses the defaults the renderer relies on instead of leaving them absent", () => {
    const deltas = readShippedV2().measures.filter((entry) => entry.id.endsWith("Lines"));
    expect(deltas.map((entry) => [entry.type, entry.aggregate, entry.sign, entry.zero])).toEqual([
      ["delta", "sum", "always", "omit"],
      ["delta", "sum", "negative-only", "omit"],
    ]);
  });

  test("scopes every result measure to workspace changes so evidence never counts as a file", () => {
    const presentationMeasures = readShippedV2().measures.filter((entry) => entry.from === "presentation");
    expect(presentationMeasures.length).toBeGreaterThan(0);
    expect(presentationMeasures.map((entry) => [entry.pointer, entry.where?.field, entry.where?.equals])).toEqual(
      presentationMeasures.map(() => ["/changes", "kind", "workspace"]),
    );
  });
});
