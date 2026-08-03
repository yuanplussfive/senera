import { describe, expect, test } from "vitest";
import { assertArtifactPolicyTemplates } from "../../../Source/AgentSystem/Artifacts/AgentArtifactTemplatePreflight.js";
import type { ToolArtifactPolicyManifest } from "../../../Source/AgentSystem/Types/AgentToolContractTypes.js";

describe("artifact template preflight", () => {
  test("accepts declared roots and loop-local variables", () => {
    const policy: ToolArtifactPolicyManifest = {
      Summary: {
        Template: "{% for entry in evidence %}{{ entry.slots.status }} {{ toolName }}{% endfor %}",
        ArtifactTemplate: "{{ artifact.artifactUri }} {{ result.state }}",
      },
      Evidence: [
        {
          Kind: "record",
          Records: "$.records[*]",
          Slots: { status: "$.status" },
          Identity: { Parts: ["status"] },
          Presentation: { Locator: "{{ status }}", Display: "{{ status }}", Label: "{{ status }}", Source: "test" },
          ModelProjection: { Slots: ["status"] },
          PlannerMemory: { Facts: ["status"] },
          Projection: {
            SummaryTemplate: "{% for entry in evidence %}{{ entry.slots.status }}{% endfor %}",
            ArtifactTemplate: "{{ kind }} {{ count }}",
          },
          Confidence: 1,
        },
      ],
    };

    expect(() => assertArtifactPolicyTemplates(policy)).not.toThrow();
  });

  test("rejects unknown global variables even in an unreachable branch", () => {
    expect(() =>
      assertArtifactPolicyTemplates({
        Summary: {
          Template: "{% if false %}{{ artifcat.artifactUri }}{% endif %}",
          ArtifactTemplate: "{{ artifact.artifactUri }}",
        },
      }),
    ).toThrow(/Summary\.Template: unknown template member artifcat/);
  });

  test("rejects misspelled declared members while permitting declared dynamic maps", () => {
    const closedResultSchema = {
      type: "object",
      properties: { state: { type: "string" } },
      additionalProperties: false,
    };

    expect(() =>
      assertArtifactPolicyTemplates(
        {
          Summary: {
            Template: "{{ artifact.artifcatUri }}",
            ArtifactTemplate: "{{ artifact.artifactUri }}",
          },
        },
        { resultSchema: closedResultSchema },
      ),
    ).toThrow(/Summary\.Template: unknown template member artifact\.artifcatUri/);
    expect(() =>
      assertArtifactPolicyTemplates(
        {
          Summary: {
            Template: "{{ evidence[0].labell }}",
            ArtifactTemplate: "{{ artifact.artifactUri }}",
          },
        },
        { resultSchema: closedResultSchema },
      ),
    ).toThrow(/Summary\.Template: unknown template member evidence\[0\]\.labell/);
    expect(() =>
      assertArtifactPolicyTemplates(
        {
          Summary: {
            Template: "{{ result.typo }}",
            ArtifactTemplate: "{{ artifact.artifactUri }}",
          },
        },
        { resultSchema: closedResultSchema },
      ),
    ).toThrow(/Summary\.Template: unknown template member result\.typo/);
    expect(() =>
      assertArtifactPolicyTemplates(
        {
          Summary: {
            Template: "{{ evidence[0].slots.any_declared_slot }}",
            ArtifactTemplate: "{{ artifact.artifactUri }}",
          },
        },
        { resultSchema: closedResultSchema },
      ),
    ).not.toThrow();
  });

  test("rejects undefined Liquid filters during publication preflight", () => {
    expect(() =>
      assertArtifactPolicyTemplates({
        Summary: {
          Template: "{{ toolName | unknown_filter }}",
          ArtifactTemplate: "{{ artifact.artifactUri }}",
        },
      }),
    ).toThrow(/undefined filter: unknown_filter/);
  });
});
