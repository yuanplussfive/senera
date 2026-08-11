import { describe, expect, test } from "vitest";
import {
  AgentToolObservationOmissionReasons,
  AgentToolObservationStructuralProjector,
} from "../../../Source/AgentSystem/ToolRuntime/AgentToolObservationStructuralProjector.js";

describe("tool observation structural projector", () => {
  test("stops at the declared object property boundary without materializing all entries", () => {
    const source = Object.fromEntries(Array.from({ length: 100_000 }, (_, index) => [`field-${index}`, index]));
    const projection = new AgentToolObservationStructuralProjector().project(
      source,
      {
        maxDepth: 4,
        maxArrayItems: 16,
        maxObjectProperties: 2,
        maxNodes: 32,
      },
      4,
    );

    expect(projection.value).toEqual({ "field-0": 0, "field-1": 1 });
    expect(projection).toMatchObject({
      complete: false,
      omissionCount: 1,
      omissions: [{ path: "/field-2", reason: AgentToolObservationOmissionReasons.ObjectLimit }],
    });
  });

  test("keeps complete scalar content for the token projector", () => {
    const content = "diagnostic output ".repeat(20_000);
    const projection = new AgentToolObservationStructuralProjector().project(
      { stdout: content },
      {
        maxDepth: 4,
        maxArrayItems: 16,
        maxObjectProperties: 2,
        maxNodes: 32,
      },
      4,
    );

    expect(projection).toMatchObject({ complete: true, omissionCount: 0 });
    expect(projection.value).toEqual({ stdout: content });
  });
});
