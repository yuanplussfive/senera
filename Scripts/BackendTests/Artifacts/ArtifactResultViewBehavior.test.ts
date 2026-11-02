import { describe, expect, test } from "vitest";
import {
  AgentArtifactResultView,
  selectAgentArtifactValue,
} from "../../../Source/AgentSystem/Artifacts/AgentArtifactResultView.js";
import { AgentTokenProjector } from "../../../Source/AgentSystem/Text/AgentTokenProjection.js";

describe("Artifact structure and exact field selection", () => {
  test("uses RFC 6901 escaping and distinguishes missing fields, null and invalid pointers", () => {
    const value = { "a/b": { "~": [null, 42] }, "": "empty key" };
    expect(selectAgentArtifactValue(value, "/a~1b/~0/0")).toMatchObject({ status: "found", value: null });
    expect(selectAgentArtifactValue(value, "/")).toMatchObject({ status: "found", value: "empty key" });
    expect(selectAgentArtifactValue(value, "")).toMatchObject({ status: "found", value });
    for (const pointer of ["/a~1b/~0/01", "/a~1b/~0/length", "/__proto__", "/missing"])
      expect(selectAgentArtifactValue(value, pointer).status).toBe("not_found");
    for (const pointer of ["field", "/~2", "/~"])
      expect(selectAgentArtifactValue(value, pointer).status).toBe("invalid_pointer");
  });

  test("keeps small scalar values and emits readable pointers and measured token counts for large fields", () => {
    const view = new AgentArtifactResultView("gpt-4o");
    const tokens = new AgentTokenProjector("gpt-4o");
    const source = {
      count: 3,
      ok: true,
      "long/body": "source detail ".repeat(2_000),
      rows: Array.from({ length: 100 }, (_, id) => ({ id, name: `record-${id}` })),
    };
    const result = view.structure(source, 600);
    expect(result.complete).toBe(false);
    expect(result.outline).toMatchObject({
      fields: {
        count: 3,
        ok: true,
        "long/body": { path: "/long~1body", type: "string", tokens: tokens.countJson(source["long/body"]) },
        rows: { path: "/rows", type: "array", length: 100 },
      },
    });
    expect(tokens.countJson(result.outline)).toBeLessThanOrEqual(600);
    expect(source.count).toBe(3);
  });

  test("large objects retain useful scalar fields and explicitly count fields omitted from the outline", () => {
    const view = new AgentArtifactResultView("gpt-4o");
    const source = {
      ...Object.fromEntries(Array.from({ length: 300 }, (_, index) => [`entry${index}`, "source detail ".repeat(30)])),
      enabled: true,
      count: 300,
    };
    const outlined = view.structure(source, 250);
    expect(outlined.outline).toMatchObject({
      type: "object",
      fieldCount: 302,
      fields: { enabled: true, count: 300 },
      omittedFields: expect.any(Number),
    });
    const fitted = view.fit(outlined, 150);
    expect(fitted.outline).toMatchObject({
      path: "",
      tokens: new AgentTokenProjector("gpt-4o").countJson(source),
      fields: { enabled: true, count: 300 },
    });
    expect(new AgentTokenProjector("gpt-4o").countJson(fitted)).toBeLessThanOrEqual(150);
    expect(JSON.stringify(fitted)).not.toContain('"path":"/fields');
  });
});
